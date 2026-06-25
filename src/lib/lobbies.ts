import { decodeAbiParameters } from "viem";
import {
  fetchLobbyLogs,
  latestBlock,
  TOPIC_RACE_CREATED,
  TOPIC_RACE_CONFIG,
  TOPIC_RACE_JOINED,
  TOPIC_RACE_RESOLVED,
  type RawLog,
} from "./chain";
import { fetchRace } from "./gigaverse";

// Live forming-lobby snapshot for Race Finder, read from the Abstract blockchain.
//
// Why chain, not REST: the Gigaverse REST API rate-limits under near-real-time
// polling, so a per-race poll loop got 429'd and the snapshot froze. The Abstract
// public RPC (api.mainnet.abs.xyz) is free, keyless, and unthrottled, so this reads
// race state straight from the PetRacingSystem event log instead. Discovery is
// incremental from a persisted block cursor (eth_getLogs over only the new blocks),
// and a forming race is reconstructed entirely from its events:
//   RACE_CONFIG  -> fieldSize, trackLength
//   RACE_CREATED -> payoutBps
//   RACE_JOINED  -> each entrant (petId, owner), in slot order
//   RACE_RESOLVED-> the race is done, drop it
// All four decodings were cross-checked against /api/racing/race/{id} on live
// races. Steady state is a single eth_getLogs per refresh.
//
// The snapshot, fan-out cache, and staleness ceiling are unchanged from before: one
// upstream read fans out to all viewers, and past the ceiling we never render an old
// snapshot as live. With an unthrottled RPC, delayed should essentially never fire.

const FRESH_MS = 4000; // a snapshot is fresh for this long
const DEGRADED_MS = 8000; // back off briefly only if an RPC read actually fails
const STALE_CEILING_MS = 60000; // past this age the snapshot is not live; do not serve it as a field
export const POLL_MS = 4000; // suggested client poll interval

// Abstract blocks are ~0.5s. A forming race lives a couple of minutes at most, so a
// ~20 minute lookback on a cold start comfortably catches anything still forming,
// and resolved/abandoned races are pruned past the same horizon.
const INITIAL_LOOKBACK_BLOCKS = 2400n;
const MAX_AGE_BLOCKS = 2400n;
const ENRICH_PER_REFRESH = 3; // cap on fee/pool REST reads for newly seen races per refresh

export interface OpenLobby {
  raceId: number;
  trackLength: number;
  raceTemp: string | null;
  fieldSize: number;
  petCount: number;
  openSlots: number;
  entryFeeWei: string;
  poolWei: string | null;
  payoutBps: number[];
  // Live protocol surcharge rates from the race config, for the paid-entry value.
  // Null until the fee enrichment has run; both tiers are carried so the entry path
  // never hardcodes a rate.
  protocolFeeBps: number | null;
  protocolFeeBpsJuiced: number | null;
  entries: { petId: number; ownerAddress: string | null; juiced: boolean }[];
}

interface RaceState {
  raceId: number;
  fieldSize: number; // 0 until the CONFIG event is seen
  trackLength: number;
  payoutBps: number[];
  entries: { petId: number; ownerAddress: string | null; juiced: boolean }[];
  resolved: boolean;
  block: number; // last block this race was touched, for pruning
  entryFeeWei: string;
  poolWei: string | null;
  protocolFeeBps: number | null;
  protocolFeeBpsJuiced: number | null;
  feeKnown: boolean; // whether the (optional) fee/pool enrichment has run
}

interface Snapshot {
  lobbies: OpenLobby[];
  // Every pet currently in an UNRESOLVED race the snapshot has seen, mapped to that
  // race id, regardless of whether the race is still forming or already full. This is
  // the fresh "is this horse busy racing" signal: a horse stays here from the moment
  // it joins until its race resolves (RACE_RESOLVED) or ages out. Carrying the race
  // id lets the caller cross-check each entry against the resolved-state in paddock-db,
  // so a stuck per-instance snapshot can never strand a horse as "racing" past the
  // ingest cadence. Full-but-unresolved races are included on purpose (a horse in a
  // locked, running race is busy too), which is why this is a superset of the forming
  // lobby entrants.
  racingByPet: Record<number, number>;
  fetchedAt: number;
  tip: number;
}

let cache: Snapshot | null = null;
let inflight: Promise<void> | null = null;
let delayed = false;
let ttl = FRESH_MS;
let cursor: bigint | null = null; // last block scanned; persists across refreshes in-process
const races = new Map<number, RaceState>();
const enriching = new Set<number>(); // races with a fee/pool read in flight, so we never double-fetch

function topicBig(t: string | undefined): number {
  return t ? Number(BigInt(t)) : 0;
}
function topicAddr(t: string | undefined): string | null {
  if (!t) return null;
  return ("0x" + t.slice(-40)).toLowerCase();
}

// payoutBps is the first uint256[] of the CREATED tuple (uint256[], uint256,
// uint256[], uint256[]); we only need that first array.
function decodePayout(data: `0x${string}`): number[] {
  try {
    const [bps] = decodeAbiParameters(
      [{ type: "uint256[]" }, { type: "uint256" }, { type: "uint256[]" }, { type: "uint256[]" }],
      data
    );
    return (bps as readonly bigint[]).map((n) => Number(n));
  } catch {
    return [];
  }
}

// CONFIG data words 0 and 1 are fieldSize and trackLength (verified against REST).
function decodeConfig(data: string): { fieldSize: number; trackLength: number } {
  const h = data.startsWith("0x") ? data.slice(2) : data;
  const word = (i: number) => (h.length >= (i + 1) * 64 ? Number(BigInt("0x" + h.slice(i * 64, i * 64 + 64))) : 0);
  return { fieldSize: word(0), trackLength: word(1) };
}

function ensureRace(raceId: number, block: number): RaceState {
  let r = races.get(raceId);
  if (!r) {
    r = { raceId, fieldSize: 0, trackLength: 0, payoutBps: [], entries: [], resolved: false, block, entryFeeWei: "0", poolWei: null, protocolFeeBps: null, protocolFeeBpsJuiced: null, feeKnown: false };
    races.set(raceId, r);
  }
  if (block > r.block) r.block = block;
  return r;
}

function applyLogs(logs: RawLog[]): void {
  // Apply in chain order so joins land after their race's creation/config.
  const ordered = [...logs].sort((a, b) => {
    const ab = Number(BigInt(a.blockNumber)) - Number(BigInt(b.blockNumber));
    return ab !== 0 ? ab : topicBig((a as unknown as { logIndex?: string }).logIndex) - topicBig((b as unknown as { logIndex?: string }).logIndex);
  });
  for (const log of ordered) {
    const t0 = log.topics[0];
    const raceId = topicBig(log.topics[1]);
    if (!raceId) continue;
    const block = Number(BigInt(log.blockNumber));
    const r = ensureRace(raceId, block);
    if (t0 === TOPIC_RACE_CONFIG) {
      const { fieldSize, trackLength } = decodeConfig(log.data);
      r.fieldSize = fieldSize;
      r.trackLength = trackLength;
    } else if (t0 === TOPIC_RACE_CREATED) {
      r.payoutBps = decodePayout(log.data as `0x${string}`);
    } else if (t0 === TOPIC_RACE_JOINED) {
      const petId = topicBig(log.topics[2]);
      const ownerAddress = topicAddr(log.topics[3]);
      if (petId && !r.entries.some((e) => e.petId === petId)) {
        r.entries.push({ petId, ownerAddress, juiced: false });
      }
    } else if (t0 === TOPIC_RACE_RESOLVED) {
      r.resolved = true;
    }
  }
}

function pruneRaces(tip: number): void {
  for (const [id, r] of races) {
    if (r.resolved || tip - r.block > Number(MAX_AGE_BLOCKS)) races.delete(id);
  }
}

// A forming lobby: created, not resolved, its field shape known, at least one horse
// in (so it is a real forming field, never an empty shell), and open slots left.
function formingLobbies(): OpenLobby[] {
  const out: OpenLobby[] = [];
  for (const r of races.values()) {
    if (r.resolved || r.fieldSize <= 0) continue;
    const petCount = r.entries.length;
    if (petCount < 1 || petCount >= r.fieldSize) continue;
    out.push({
      raceId: r.raceId,
      trackLength: r.trackLength,
      raceTemp: null, // conditions are assigned when the race starts, not while forming
      fieldSize: r.fieldSize,
      petCount,
      openSlots: r.fieldSize - petCount,
      entryFeeWei: r.entryFeeWei,
      poolWei: r.poolWei,
      payoutBps: r.payoutBps,
      protocolFeeBps: r.protocolFeeBps,
      protocolFeeBpsJuiced: r.protocolFeeBpsJuiced,
      entries: r.entries.map((e) => ({ ...e })),
    });
  }
  out.sort((a, b) => b.raceId - a.raceId); // newest first
  return out;
}

// Every pet in an unresolved race the snapshot currently holds, mapped to that race
// id. Forming AND full-but-unresolved races count: a horse is busy from join until
// resolution. Resolved races are excluded (the horse is free again). This is the
// fresh racing signal the roster uses, cross-checked against paddock-db for safety.
function racingByPetFromMap(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of races.values()) {
    if (r.resolved) continue;
    for (const e of r.entries) {
      // If somehow seen in more than one open race, keep the newest race id.
      if (out[e.petId] == null || r.raceId > out[e.petId]) out[e.petId] = r.raceId;
    }
  }
  return out;
}

// entryFee and pool are not carried by the events, so for EV on the rare paid race
// we read them once per race from the public API, cache them, and tolerate failure
// (default free, EV null). This is strictly off the hot path: at most a few reads
// for newly seen races, never per-poll-per-race, and a failure here can never freeze
// the snapshot or flip delayed (that is driven only by the RPC read).
async function enrichFees(lobbies: OpenLobby[]): Promise<void> {
  const fresh = lobbies.filter((l) => {
    const r = races.get(l.raceId);
    return r && !r.feeKnown && !enriching.has(l.raceId);
  }).slice(0, ENRICH_PER_REFRESH);
  await Promise.allSettled(fresh.map(async (l) => {
    enriching.add(l.raceId);
    try {
      const race = await fetchRace(l.raceId);
      const r = races.get(l.raceId);
      if (r) {
        r.entryFeeWei = String(race.entryFee ?? "0");
        r.poolWei = race.pool != null ? String(race.pool) : null;
        // Live protocol surcharge rates for the paid-entry value (both tiers).
        r.protocolFeeBps = Number.isFinite(race.protocolFeeBps) ? race.protocolFeeBps : null;
        r.protocolFeeBpsJuiced = Number.isFinite(race.protocolFeeBpsJuiced) ? race.protocolFeeBpsJuiced : null;
        const juicedByPet = new Map((race.entries ?? []).map((e) => [e.petId, !!e.juiced]));
        for (const e of r.entries) e.juiced = juicedByPet.get(e.petId) ?? e.juiced;
        r.feeKnown = true;
      }
    } catch {
      // leave fee at 0 (treated as a free race, EV null); never blocks the lobby
    } finally {
      enriching.delete(l.raceId);
    }
  }));
}

async function doRefresh(): Promise<void> {
  try {
    const tip = await latestBlock();
    const from = cursor == null ? tip - INITIAL_LOOKBACK_BLOCKS + 1n : cursor + 1n;
    if (from <= tip) {
      const logs = await fetchLobbyLogs(from < 0n ? 0n : from, tip);
      applyLogs(logs);
    }
    cursor = tip;
    const tipNum = Number(tip);
    pruneRaces(tipNum);
    const lobbies = formingLobbies();
    // Best-effort fee/pool enrichment for newly seen forming races (off hot path).
    await enrichFees(lobbies);
    cache = { lobbies: formingLobbies(), racingByPet: racingByPetFromMap(), fetchedAt: Date.now(), tip: tipNum };
    delayed = false;
    ttl = FRESH_MS;
  } catch {
    // An RPC read failed: keep the last snapshot, flag delayed, back off briefly.
    // With an unthrottled RPC this should essentially never happen.
    delayed = true;
    ttl = DEGRADED_MS;
  }
}

// Returns the current snapshot. When the snapshot is stale, the refresh is AWAITED
// within the request, never fired into the background. On Vercel this route is a
// serverless function that is frozen the instant its HTTP response is sent, so a
// background promise would never complete and the snapshot would age forever, hit
// the ceiling, and serve empty+delayed permanently. Awaiting keeps the function
// alive until the snapshot actually advances. Single-flight is preserved via the
// in-process `inflight` promise: concurrent requests on the same warm instance
// share one upstream read, so the RPC still sees roughly one eth_getLogs per FRESH
// window, not one per request. A single eth_getLogs is fast, so awaiting per stale
// read adds negligible latency and is the correct tradeoff for never freezing.
export async function getOpenLobbies(): Promise<{ lobbies: OpenLobby[]; racingByPet: Record<number, number>; fetchedAt: number | null; delayed: boolean }> {
  const stale = !cache || Date.now() - cache.fetchedAt >= ttl;
  if (stale) {
    if (!inflight) inflight = doRefresh().finally(() => { inflight = null; });
    await inflight; // serverless safe: the response waits, so the refresh truly runs
  }

  const fetchedAt = cache?.fetchedAt ?? null;
  // Re-read the clock after awaiting: a successful refresh has just advanced
  // cache.fetchedAt. Only a genuinely failed RPC read leaves the snapshot past the
  // ceiling, and even then the next request awaits a fresh attempt and recovers, so
  // a single failure can never wedge the instance into permanent empty.
  const age = cache ? Date.now() - cache.fetchedAt : Infinity;
  if (age > STALE_CEILING_MS) {
    return { lobbies: [], racingByPet: {}, fetchedAt, delayed: true };
  }
  return { lobbies: cache?.lobbies ?? [], racingByPet: cache?.racingByPet ?? {}, fetchedAt, delayed };
}
