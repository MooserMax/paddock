import { db } from "./db";
import type { GigaRace } from "./gigaverse";

// Live forming-lobby snapshot for Race Finder. Lobbies form and fill in seconds,
// faster than the slow cron, so this polls the Gigaverse REST API directly, but
// politely: only on demand (when a viewer's client requests it, never a background
// job), bounded to the frontier window (not history), with a short server-side
// cache so one upstream poll fans out to all concurrent viewers. Stale-while-
// revalidate: a cached snapshot returns instantly while a single in-flight refresh
// runs, so 100 viewers do not mean 100x the upstream calls. Exponential degrade on
// throttling: on a 429 or failure we keep serving the last snapshot, flagged
// delayed, and back off the next refresh.

const BASE = "https://gigaverse.io/api";
const WINDOW_BELOW = 16; // races below the frontier to scan for forming lobbies
const WINDOW_ABOVE = 4; // probe a few above the known max for brand-new lobbies
const CONCURRENCY = 4; // polite parallelism per refresh
const FRESH_MS = 4000; // a snapshot is fresh for this long
const DEGRADED_MS = 15000; // back off the refresh cadence when upstream throttles
const FETCH_TIMEOUT_MS = 4000;
export const POLL_MS = 4000; // suggested client poll interval

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
  entries: { petId: number; ownerAddress: string | null; juiced: boolean }[];
}

interface Snapshot {
  lobbies: OpenLobby[];
  fetchedAt: number;
  frontier: number;
}

let cache: Snapshot | null = null;
let inflight: Promise<void> | null = null;
let delayed = false;
let ttl = FRESH_MS;

async function quickFetchRace(id: number): Promise<GigaRace | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/racing/race/${id}`, { headers: { accept: "application/json" }, cache: "no-store", signal: ctl.signal });
    if (!res.ok) {
      if (res.status === 429) throw new Error("429"); // surfaces as throttle to the caller
      return null; // 404 or other: this id simply has no forming lobby
    }
    return (await res.json()) as GigaRace;
  } finally {
    clearTimeout(timer);
  }
}

async function frontierMax(): Promise<number> {
  const { data } = await db().from("races").select("race_id").order("race_id", { ascending: false }).limit(1).maybeSingle();
  return (data?.race_id as number | undefined) ?? 0;
}

async function refreshSnapshot(): Promise<Snapshot> {
  const maxId = await frontierMax();
  const ids: number[] = [];
  for (let id = maxId - WINDOW_BELOW; id <= maxId + WINDOW_ABOVE; id++) if (id > 0) ids.push(id);

  const lobbies: OpenLobby[] = [];
  let throttled = false;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(quickFetchRace));
    for (const r of results) {
      if (r.status === "rejected") { throttled = true; continue; }
      const race = r.value;
      if (!race || !race.success || race.phase !== 1) continue; // phase 1 is a forming lobby
      const fieldSize = race.fieldSize ?? 0;
      const entries = race.entries ?? [];
      const petCount = entries.length;
      const openSlots = fieldSize - petCount;
      if (openSlots <= 0 || fieldSize <= 0) continue; // full or unstarted shell
      lobbies.push({
        raceId: race.raceId,
        trackLength: race.trackLength,
        raceTemp: race.raceTemp || null,
        fieldSize,
        petCount,
        openSlots,
        entryFeeWei: String(race.entryFee ?? "0"),
        poolWei: race.pool != null ? String(race.pool) : null,
        payoutBps: race.payoutBps ?? [],
        entries: entries.map((e) => ({ petId: e.petId, ownerAddress: e.ownerAddress?.toLowerCase() ?? null, juiced: !!e.juiced })),
      });
    }
  }
  lobbies.sort((a, b) => b.raceId - a.raceId); // newest first
  if (throttled) throw new Error("throttled");
  return { lobbies, fetchedAt: Date.now(), frontier: maxId };
}

async function doRefresh(): Promise<void> {
  try {
    cache = await refreshSnapshot();
    delayed = false;
    ttl = FRESH_MS;
  } catch {
    // Keep the last snapshot; flag delayed and back off the next refresh.
    delayed = true;
    ttl = DEGRADED_MS;
  }
}

// Returns the current snapshot. Serves a cached snapshot instantly and kicks off
// at most one background refresh when stale (stale-while-revalidate); only the very
// first call, with no cache yet, awaits the refresh.
export async function getOpenLobbies(): Promise<{ lobbies: OpenLobby[]; fetchedAt: number | null; delayed: boolean }> {
  const now = Date.now();
  const stale = !cache || now - cache.fetchedAt >= ttl;
  if (stale && !inflight) inflight = doRefresh().finally(() => { inflight = null; });
  if (!cache && inflight) await inflight; // first load blocks until we have data
  return { lobbies: cache?.lobbies ?? [], fetchedAt: cache?.fetchedAt ?? null, delayed };
}
