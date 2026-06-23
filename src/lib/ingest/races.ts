import { decodeAbiParameters } from "viem";
import { db } from "../db";
import {
  RACING_START_BLOCK,
  decodeRacingLog,
  fetchRacingLogs,
  fetchLobbyLogs,
  latestBlock,
  RaceResolved,
  TOPIC_RACE_CREATED,
  TOPIC_RACE_CONFIG,
  TOPIC_RACE_JOINED,
  TOPIC_RACE_RESOLVED,
  type RawLog,
} from "../chain";
import { fetchRace, sleep, REQUEST_GAP_MS } from "../gigaverse";
import { getSyncState, setSyncState } from "../syncState";

const SCAN_STATE_KEY = "races_scan";
const SCAN_WINDOW = 100_000n;

interface ScanState {
  lastBlock: string;
}

export interface ScanResult {
  fromBlock: string;
  toBlock: string;
  caughtUp: boolean;
  created: number;
  resolved: number;
}

// Scan RaceCreated / RaceResolved events forward from the checkpoint.
// The chain is the spine: this is gap-free and idempotent. Checkpoint moves
// only after a window is fully written, so a crash re-scans, never skips.
export async function scanRaces(budgetMs: number): Promise<ScanResult> {
  const deadline = Date.now() + budgetMs;
  const state = await getSyncState<ScanState>(SCAN_STATE_KEY);
  const startBlock = state ? BigInt(state.lastBlock) + 1n : RACING_START_BLOCK;
  const head = await latestBlock();

  let cursor = startBlock;
  let created = 0;
  let resolved = 0;

  while (cursor <= head && Date.now() < deadline) {
    const windowEnd = cursor + SCAN_WINDOW - 1n > head ? head : cursor + SCAN_WINDOW - 1n;
    const logs = await fetchRacingLogs(cursor, windowEnd);
    const events = logs
      .map(decodeRacingLog)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const createdRows = events
      .filter((e) => e.kind === "created")
      .map((e) => ({ race_id: Number(e.raceId), block_number: Number(e.blockNumber) }));
    if (createdRows.length > 0) {
      const { error } = await db()
        .from("races")
        .upsert(createdRows, { onConflict: "race_id", ignoreDuplicates: true });
      if (error) throw new Error(`races insert failed: ${error.message}`);
      created += createdRows.length;
    }

    const resolvedEvents = events.filter((e): e is RaceResolved => e.kind === "resolved");
    if (resolvedEvents.length > 0) {
      const { error } = await db()
        .from("races")
        .upsert(
          resolvedEvents.map((e) => ({ race_id: Number(e.raceId), resolved: true })),
          { onConflict: "race_id" }
        );
      if (error) throw new Error(`races resolve update failed: ${error.message}`);

      const entryRows = resolvedEvents.flatMap((e) =>
        e.finishOrder.map((petId, i) => ({
          race_id: Number(e.raceId),
          pet_id: Number(petId),
          finish_position: i + 1,
          finish_time_ms: Number(e.finishTimesMs[i] ?? 0) || null,
        }))
      );
      for (let i = 0; i < entryRows.length; i += 500) {
        const { error: entryError } = await db()
          .from("race_entries")
          .upsert(entryRows.slice(i, i + 500), { onConflict: "race_id,pet_id" });
        if (entryError) throw new Error(`race_entries upsert failed: ${entryError.message}`);
      }
      resolved += resolvedEvents.length;
    }

    await setSyncState(SCAN_STATE_KEY, { lastBlock: windowEnd.toString() } satisfies ScanState);
    cursor = windowEnd + 1n;
  }

  return {
    fromBlock: startBlock.toString(),
    toBlock: (cursor - 1n).toString(),
    caughtUp: cursor > head,
    created,
    resolved,
  };
}

export interface HydrateResult {
  hydrated: number;
  terminal: number;
  remaining: number;
}

// A race that reached the game's terminal phase (4) without ever producing a
// finalRanking never ran: it was created but did not draw enough entrants and
// expired. We mark these hydrated=true while leaving resolved=false, so they are
// a distinct "abandoned" state, no longer retried forever and no longer counted
// as pending against the resolved total.
const TERMINAL_PHASE = 4;

// Fill in race details from the public race API. Resolved races get full details
// + entries; terminal (expired-unfilled) races get classified so they stop being
// retried; open races are left hydrated=false for a later run.
export async function hydrateRaces(maxRaces: number, deadline?: number, gapMs: number = REQUEST_GAP_MS, staleLagIds = 0): Promise<HydrateResult> {
  // Candidates are mostly NEWEST (the live frontier must resolve every cycle and
  // can never be starved behind old un-resolvable shells), plus a small slice of
  // OLDEST so long-dead phase-1 shells get reached and cleared. EVERY race is
  // fetched and checked, so a finished race is always resolved and never abandoned
  // blindly; only a fetched, confirmed-not-finished, stale race is abandoned.
  const { data: maxRow } = await db().from("races").select("race_id").order("race_id", { ascending: false }).limit(1).maybeSingle();
  const maxId = (maxRow?.race_id as number | undefined) ?? 0;

  const oldestSlice = staleLagIds > 0 ? Math.min(8, Math.floor(maxRaces / 3)) : 0;
  const { data: newest, error, count } = await db()
    .from("races").select("race_id", { count: "exact" })
    .eq("hydrated", false).order("race_id", { ascending: false }).limit(maxRaces - oldestSlice);
  if (error) throw new Error(`hydration candidate query failed: ${error.message}`);
  let oldest: { race_id: number }[] = [];
  if (oldestSlice > 0) {
    const { data } = await db().from("races").select("race_id").eq("hydrated", false).order("race_id", { ascending: true }).limit(oldestSlice);
    oldest = (data ?? []) as { race_id: number }[];
  }
  const seen = new Set<number>();
  const candidates: number[] = [];
  for (const r of [...((newest ?? []) as { race_id: number }[]), ...oldest]) {
    if (!seen.has(r.race_id)) { seen.add(r.race_id); candidates.push(r.race_id); }
  }

  let hydrated = 0;
  let terminal = 0;
  for (const raceId of candidates) {
    // Stop cleanly if we are out of wall-clock budget; remaining is returned so
    // the caller knows more work is pending for the next run.
    if (deadline && Date.now() > deadline) break;
    const race = await fetchRace(raceId);
    await sleep(gapMs);

    const isResolved = race.success && Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
    if (isResolved) {
      const maxFinishMs = race.finishTimes.length > 0 ? Math.max(...race.finishTimes) : 0;
      const resolvedAt = new Date((race.raceStart + maxFinishMs / 1000) * 1000).toISOString();
      const { error: raceError } = await db()
        .from("races")
        .update({
          field_size: race.fieldSize,
          track_length: race.trackLength,
          race_temp: race.raceTemp,
          entry_fee_wei: race.entryFee,
          creator: race.creator?.toLowerCase() ?? null,
          payout_bps: race.payoutBps,
          fee_bps: {
            creator: race.creatorFeeBps,
            protocol: race.protocolFeeBps,
            protocolJuiced: race.protocolFeeBpsJuiced,
            jackpot: race.jackpotBps,
          },
          race_start: new Date(race.raceStart * 1000).toISOString(),
          resolved_at: resolvedAt,
          resolved: true,
          hydrated: true,
        })
        .eq("race_id", raceId);
      if (raceError) throw new Error(`race hydration update failed: ${raceError.message}`);

      const entryRows = race.finalRanking.map((petId, i) => ({
        race_id: raceId,
        pet_id: petId,
        owner_address: race.petOwners[String(petId)]?.toLowerCase() ?? null,
        finish_position: i + 1,
        finish_time_ms: race.finishTimes[i] ?? null,
        payout_wei: race.petPayouts[String(petId)]?.amount ?? null,
      }));
      if (entryRows.length > 0) {
        const { error: entryError } = await db().from("race_entries").upsert(entryRows, { onConflict: "race_id,pet_id" });
        if (entryError) throw new Error(`race_entries hydration failed: ${entryError.message}`);
      }
      hydrated += 1;
      continue;
    }

    // Not resolved. Abandon ONLY after fetching and confirming no finalRanking,
    // when the race is terminal (phase >= 4) or stale (the frontier passed it by
    // more than staleLagIds and it still never filled). Recent open races are left
    // pending so they resolve once they finish. This is why a finished race in a
    // backlog is never lost: we abandon only what we have checked.
    const isTerminal = race.success && typeof race.phase === "number" && race.phase >= TERMINAL_PHASE;
    const isStale = staleLagIds > 0 && maxId - raceId > staleLagIds;
    if (isTerminal || isStale) {
      const { error: tErr } = await db()
        .from("races")
        .update({
          field_size: race.fieldSize ?? null,
          track_length: race.trackLength ?? null,
          entry_fee_wei: race.entryFee ?? null,
          race_start: race.raceStart ? new Date(race.raceStart * 1000).toISOString() : null,
          hydrated: true,
        })
        .eq("race_id", raceId);
      if (tErr) throw new Error(`abandoned-race classify failed: ${tErr.message}`);
      terminal += 1;
    }
  }

  return { hydrated, terminal, remaining: (count ?? 0) - hydrated - terminal };
}

// API-driven forward discovery. The public RPC's eth_getLogs does not serve
// recent logs (it lags ~2.6 days and growing), so it is blind to new races. The
// Gigaverse race API is current, so we discover races by id from our max upward,
// inserting each (resolved with entries if finished, else as an open row to be
// resolved later by hydrateRaces). This is what actually advances us to head.
export interface CatchUpResult {
  scanned: number;
  inserted: number;
  resolved: number;
  fromRaceId: number;
  reachedRaceId: number;
  caughtUp: boolean;
}

const MISSING_STREAK_LIMIT = 6;

// Upsert one race (plus its entries if resolved) from a fetched API payload.
// Shared by forward catch-up and gap backfill. Returns whether it was resolved.
async function upsertRaceFromApi(id: number, race: Awaited<ReturnType<typeof fetchRace>>): Promise<boolean> {
  const isResolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
  const maxFinishMs = isResolved && race.finishTimes.length > 0 ? Math.max(...race.finishTimes) : 0;
  // A non-resolved race already at the terminal phase never ran (expired empty):
  // mark it hydrated so it is the "abandoned" state, not retried or left pending.
  const isTerminal = !isResolved && typeof race.phase === "number" && race.phase >= TERMINAL_PHASE;

  const { error: rErr } = await db().from("races").upsert(
    {
      race_id: id,
      field_size: race.fieldSize ?? null,
      track_length: race.trackLength ?? null,
      race_temp: race.raceTemp ?? null,
      entry_fee_wei: race.entryFee ?? null,
      creator: race.creator?.toLowerCase() ?? null,
      payout_bps: race.payoutBps ?? null,
      fee_bps: {
        creator: race.creatorFeeBps,
        protocol: race.protocolFeeBps,
        protocolJuiced: race.protocolFeeBpsJuiced,
        jackpot: race.jackpotBps,
      },
      race_start: race.raceStart ? new Date(race.raceStart * 1000).toISOString() : null,
      resolved: isResolved,
      resolved_at: isResolved ? new Date((race.raceStart + maxFinishMs / 1000) * 1000).toISOString() : null,
      hydrated: isResolved || isTerminal,
    },
    { onConflict: "race_id" }
  );
  if (rErr) throw new Error(`race upsert failed: ${rErr.message}`);

  if (isResolved) {
    const entryRows = race.finalRanking.map((petId, i) => ({
      race_id: id,
      pet_id: petId,
      owner_address: race.petOwners[String(petId)]?.toLowerCase() ?? null,
      finish_position: i + 1,
      finish_time_ms: race.finishTimes[i] ?? null,
      payout_wei: race.petPayouts[String(petId)]?.amount ?? null,
    }));
    if (entryRows.length > 0) {
      const { error: eErr } = await db().from("race_entries").upsert(entryRows, { onConflict: "race_id,pet_id" });
      if (eErr) throw new Error(`race_entries upsert failed: ${eErr.message}`);
    }
  }
  return isResolved;
}

export interface BackfillResult {
  scanned: number;
  inserted: number;
  resolved: number;
  missing: number;
}

// Fetch and upsert a specific set of race ids: the historical gaps the forward
// catch-up skipped (abandoned-empty races, and races that were empty when first
// passed and have since resolved). Idempotent; existing rows are re-upserted.
export async function ingestRacesByIds(ids: number[], gapMs: number = REQUEST_GAP_MS): Promise<BackfillResult> {
  let scanned = 0;
  let inserted = 0;
  let resolved = 0;
  let missing = 0;
  for (const id of ids) {
    let race: Awaited<ReturnType<typeof fetchRace>> | null = null;
    try {
      race = await fetchRace(id);
    } catch {
      race = null;
    }
    await sleep(gapMs);
    scanned += 1;
    const exists = !!race && race.success && race.phase != null;
    if (!exists || !race) {
      missing += 1;
      continue;
    }
    if (await upsertRaceFromApi(id, race)) resolved += 1;
    inserted += 1;
  }
  return { scanned, inserted, resolved, missing };
}

export async function catchUpRaces(maxRaces: number, deadline?: number, gapMs: number = REQUEST_GAP_MS): Promise<CatchUpResult> {
  const { data: maxRow } = await db()
    .from("races")
    .select("race_id")
    .order("race_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startId = (maxRow?.race_id ?? 0) + 1;

  let id = startId;
  let scanned = 0;
  let inserted = 0;
  let resolved = 0;
  let missing = 0;

  // Bounded by race count AND wall-clock: caughtUp stays false if we stop on the
  // deadline before hitting the missing-streak frontier, so the caller continues
  // from the new cursor next run.
  while (missing < MISSING_STREAK_LIMIT && scanned < maxRaces && (!deadline || Date.now() < deadline)) {
    let race: Awaited<ReturnType<typeof fetchRace>> | null = null;
    try {
      race = await fetchRace(id);
    } catch {
      race = null;
    }
    await sleep(gapMs);
    scanned += 1;

    // A real (created) race id returns success with a phase, even when it has not
    // drawn entrants yet or expired empty (phase 4, racePets 0). Only a hard
    // success=false means the id does not exist. Requiring racePets here used to
    // skip real-but-empty races AND inflate the missing streak, which could halt
    // catch-up before the true frontier; treat any real race as existing so we
    // always reach head (empty ones go in as open rows for hydrateRaces to
    // classify terminal).
    const exists = !!race && race.success && race.phase != null;
    if (!exists || !race) {
      missing += 1;
      id += 1;
      continue;
    }
    missing = 0;

    if (await upsertRaceFromApi(id, race)) resolved += 1;
    inserted += 1;
    id += 1;
  }

  return { scanned, inserted, resolved, fromRaceId: startId, reachedRaceId: id - 1, caughtUp: missing >= MISSING_STREAK_LIMIT };
}

// ---------------------------------------------------------------------------
// RPC-sourced resolved-race records ingest.
//
// The records pipeline (condition-adjusted finish times) needs finish_time_ms,
// finish order, track_length, field_size, owners and payouts. Every one of those
// except race_temp is on-chain in the live PetRacingSystem event log, verified by
// decoding real events against /api/racing/race/{id}:
//   RACE_RESOLVED -> finishOrder (pet ids, in order) and finishTimesMs
//   RACE_CONFIG   -> fieldSize, trackLength, creator
//   RACE_CREATED  -> payoutBps
//   RACE_JOINED   -> owner per pet
// So the records-critical numbers come from eth_getLogs in block-range batches
// (one call covers many races), not a per-race REST fetch, and can never be lost
// to a 429. race_temp is assigned at race start and is NOT in any event, so it
// stays a bounded, fault-isolated REST read here, exactly like the lobby fee
// enrichment. Everything is idempotent (existing rows are re-upserted).

const RESOLVED_RPC_STATE_KEY = "resolved_scan_rpc";
const RPC_COLD_LOOKBACK = 12_000n; // ~100 min at ~0.5s/block: a safe recent window on a cold start
const RPC_MAX_WINDOW = 40_000n; // cap blocks scanned per call; fetchLobbyLogs halves on rejection
// RACE_CREATED data is the tuple (uint256[] payoutBps, uint256, uint256[], uint256[]);
// we only need the first array. Verified against live events in lobbies.ts.
const PETRACING_CREATED_DATA = [
  { type: "uint256[]" },
  { type: "uint256" },
  { type: "uint256[]" },
  { type: "uint256[]" },
] as const;

interface RpcRace {
  raceId: number;
  fieldSize: number | null;
  trackLength: number | null;
  creator: string | null;
  payoutBps: number[] | null;
  owners: Map<number, string | null>;
  finishOrder: number[];
  finishTimesMs: number[];
  resolved: boolean;
}

function topicInt(t: string | undefined): number {
  return t ? Number(BigInt(t)) : 0;
}
function topicAddress(t: string | undefined): string | null {
  return t ? ("0x" + t.slice(-40)).toLowerCase() : null;
}
function configWords(data: string): { fieldSize: number; trackLength: number } {
  const h = data.startsWith("0x") ? data.slice(2) : data;
  const word = (i: number) => (h.length >= (i + 1) * 64 ? Number(BigInt("0x" + h.slice(i * 64, i * 64 + 64))) : 0);
  return { fieldSize: word(0), trackLength: word(1) };
}
function createdPayout(data: `0x${string}`): number[] {
  try {
    const [bps] = decodeAbiParameters(PETRACING_CREATED_DATA, data);
    return (bps as readonly bigint[]).map((n) => Number(n));
  } catch {
    return [];
  }
}

function reconstructRaces(logs: RawLog[]): Map<number, RpcRace> {
  const races = new Map<number, RpcRace>();
  const get = (raceId: number): RpcRace => {
    let r = races.get(raceId);
    if (!r) {
      r = { raceId, fieldSize: null, trackLength: null, creator: null, payoutBps: null, owners: new Map(), finishOrder: [], finishTimesMs: [], resolved: false };
      races.set(raceId, r);
    }
    return r;
  };
  // Order by block then logIndex so config/joins land before resolution.
  const ordered = [...logs].sort((a, b) => {
    const ab = Number(BigInt(a.blockNumber)) - Number(BigInt(b.blockNumber));
    return ab !== 0 ? ab : topicInt((a as unknown as { logIndex?: string }).logIndex) - topicInt((b as unknown as { logIndex?: string }).logIndex);
  });
  for (const log of ordered) {
    const t0 = log.topics[0];
    const raceId = topicInt(log.topics[1]);
    if (!raceId) continue;
    const r = get(raceId);
    if (t0 === TOPIC_RACE_CONFIG) {
      const { fieldSize, trackLength } = configWords(log.data);
      r.fieldSize = fieldSize;
      r.trackLength = trackLength;
      r.creator = topicAddress(log.topics[2]);
    } else if (t0 === TOPIC_RACE_CREATED) {
      r.payoutBps = createdPayout(log.data as `0x${string}`);
    } else if (t0 === TOPIC_RACE_JOINED) {
      const petId = topicInt(log.topics[2]);
      if (petId) r.owners.set(petId, topicAddress(log.topics[3]));
    } else if (t0 === TOPIC_RACE_RESOLVED) {
      const ev = decodeRacingLog(log);
      if (ev && ev.kind === "resolved") {
        r.finishOrder = ev.finishOrder.map((n) => Number(n));
        r.finishTimesMs = ev.finishTimesMs.map((n) => Number(n));
        r.resolved = true;
      }
    }
  }
  return races;
}

export interface ResolvedRpcResult {
  fromBlock: string;
  toBlock: string;
  caughtUp: boolean;
  resolved: number; // resolved races written from chain logs this run
  tempEnriched: number; // races that also got race_temp/fees from a bounded REST read
  tempFailed: number; // bounded REST reads that failed (left for the REST fallback)
}

// Read RACE_RESOLVED (and the config/created/joined context) forward from a
// persisted block cursor, write each resolved race's records data from chain, and
// fill the one off-chain field (race_temp, plus fees) with a bounded, fault-
// isolated REST read. Gap-free and idempotent: the cursor advances only after a
// window is written, so a crash re-scans and never skips.
export async function scanResolvedRacesRpc(opts: { tempBudget: number; deadline?: number } = { tempBudget: 30 }): Promise<ResolvedRpcResult> {
  const head = await latestBlock();
  const state = await getSyncState<{ lastBlock: string }>(RESOLVED_RPC_STATE_KEY);
  const startBlock = state ? BigInt(state.lastBlock) + 1n : (head - RPC_COLD_LOOKBACK > 0n ? head - RPC_COLD_LOOKBACK : 0n);
  if (startBlock > head) {
    return { fromBlock: startBlock.toString(), toBlock: head.toString(), caughtUp: true, resolved: 0, tempEnriched: 0, tempFailed: 0 };
  }
  const windowEnd = startBlock + RPC_MAX_WINDOW - 1n > head ? head : startBlock + RPC_MAX_WINDOW - 1n;

  const logs = await fetchLobbyLogs(startBlock, windowEnd);
  const races = reconstructRaces(logs);
  const resolvedRaces = [...races.values()].filter((r) => r.resolved && r.finishOrder.length > 0);

  let resolved = 0;
  for (const r of resolvedRaces) {
    // races row: on-chain fields only here; race_temp/fees come from the bounded
    // REST pass below. hydrated stays false so the existing REST hydrate is the
    // fallback if the bounded read does not land.
    const { error: rErr } = await db().from("races").upsert(
      {
        race_id: r.raceId,
        field_size: r.fieldSize,
        track_length: r.trackLength,
        creator: r.creator,
        payout_bps: r.payoutBps,
        resolved: true,
      },
      { onConflict: "race_id" }
    );
    if (rErr) throw new Error(`rpc race upsert failed: ${rErr.message}`);

    const entryRows = r.finishOrder.map((petId, i) => ({
      race_id: r.raceId,
      pet_id: petId,
      owner_address: r.owners.get(petId) ?? null,
      finish_position: i + 1,
      finish_time_ms: r.finishTimesMs[i] ?? null,
    }));
    if (entryRows.length > 0) {
      const { error: eErr } = await db().from("race_entries").upsert(entryRows, { onConflict: "race_id,pet_id" });
      if (eErr) throw new Error(`rpc race_entries upsert failed: ${eErr.message}`);
    }
    resolved += 1;
  }

  // Bounded, fault-isolated REST pass for the off-chain field (race_temp) and the
  // fee/payout detail not in events. Only resolved races still missing race_temp,
  // capped, newest first. A failure here never loses the on-chain records data.
  let tempEnriched = 0;
  let tempFailed = 0;
  if (resolvedRaces.length > 0 && opts.tempBudget > 0) {
    const ids = resolvedRaces.map((r) => r.raceId).sort((a, b) => b - a);
    const { data: needing } = await db()
      .from("races").select("race_id")
      .in("race_id", ids).is("race_temp", null);
    const needSet = new Set((needing ?? []).map((x) => x.race_id as number));
    const targets = ids.filter((id) => needSet.has(id)).slice(0, opts.tempBudget);
    for (const raceId of targets) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      try {
        const race = await fetchRace(raceId);
        await sleep(REQUEST_GAP_MS);
        if (!race.success) { tempFailed += 1; continue; }
        const isResolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
        const maxFinishMs = isResolved && race.finishTimes.length > 0 ? Math.max(...race.finishTimes) : 0;
        const { error: tErr } = await db().from("races").update({
          race_temp: race.raceTemp ?? null,
          entry_fee_wei: race.entryFee ?? null,
          field_size: race.fieldSize ?? null,
          track_length: race.trackLength ?? null,
          payout_bps: race.payoutBps ?? null,
          creator: race.creator?.toLowerCase() ?? null,
          fee_bps: { creator: race.creatorFeeBps, protocol: race.protocolFeeBps, protocolJuiced: race.protocolFeeBpsJuiced, jackpot: race.jackpotBps },
          race_start: race.raceStart ? new Date(race.raceStart * 1000).toISOString() : null,
          resolved_at: isResolved ? new Date((race.raceStart + maxFinishMs / 1000) * 1000).toISOString() : null,
          hydrated: true,
        }).eq("race_id", raceId);
        if (tErr) throw new Error(tErr.message);
        // Backfill owner/payout detail on entries that the events left null.
        if (isResolved) {
          const entryRows = race.finalRanking.map((petId, i) => ({
            race_id: raceId,
            pet_id: petId,
            owner_address: race.petOwners[String(petId)]?.toLowerCase() ?? null,
            finish_position: i + 1,
            finish_time_ms: race.finishTimes[i] ?? null,
            payout_wei: race.petPayouts[String(petId)]?.amount ?? null,
          }));
          if (entryRows.length > 0) await db().from("race_entries").upsert(entryRows, { onConflict: "race_id,pet_id" });
        }
        tempEnriched += 1;
      } catch {
        tempFailed += 1; // leave hydrated=false; the existing REST hydrate retries it
      }
    }
  }

  await setSyncState(RESOLVED_RPC_STATE_KEY, { lastBlock: windowEnd.toString() });
  return {
    fromBlock: startBlock.toString(),
    toBlock: windowEnd.toString(),
    caughtUp: windowEnd >= head,
    resolved,
    tempEnriched,
    tempFailed,
  };
}
