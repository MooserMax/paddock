import { db } from "./db";
import type { GigaRace } from "./gigaverse";

// Live forming-lobby snapshot for Race Finder. Lobbies form and fill in seconds,
// faster than the slow cron, so this polls the Gigaverse REST API directly, but
// politely: only on demand (when a viewer's client requests it, never a background
// job), bounded to the frontier window (not history), with a short server-side
// cache so one upstream poll fans out to all concurrent viewers. Stale-while-
// revalidate: a cached snapshot returns instantly while a single in-flight refresh
// runs, so 100 viewers do not mean 100x the upstream calls.
//
// Resilience model (the part that previously got stuck):
//  - A 429 on one id in the window does NOT discard the whole refresh. Any
//    successful upstream round-trip updates the snapshot and clears delayed, so a
//    partial throttle can never freeze the cache. delayed is true ONLY when an
//    entire refresh got zero successful fetches.
//  - Resolved races (phase != 1 never re-forms) are remembered and skipped, so the
//    steady-state poll keeps re-fetching only the genuinely forming frontier band
//    plus a small probe above it. This keeps the per-refresh call budget low enough
//    not to trip the rate limit in the first place.
//  - The frontier estimate walks up toward the live edge whenever real races are
//    found above the DB max, so a lagging cron does not strand the scan below the
//    forming lobbies.
//  - A hard staleness ceiling: past it, the snapshot is not "live"; we stop serving
//    its lobbies as a current field and show the delayed state instead.

const BASE = "https://gigaverse.io/api";
const WINDOW_BELOW = 4; // forming lobbies sit at the frontier; a few below catch just-created ids
const WINDOW_ABOVE = 6; // probe above the DB max for brand-new lobbies and to walk up a lagging frontier
const CONCURRENCY = 3; // polite parallelism per refresh
const FRESH_MS = 4000; // a clean snapshot is fresh for this long
const MILD_BACKOFF_MS = 8000; // ease off briefly after a partial throttle, then return to FRESH_MS
const DEGRADED_MS = 15000; // back off the refresh cadence when a whole refresh fails
const STALE_CEILING_MS = 60000; // past this age the snapshot is not live; do not serve it as a field
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
let frontierEst = 0; // highest race id known to exist; walks up toward the live edge
const resolved = new Set<number>(); // race ids past forming (phase != 1); never re-fetched

async function quickFetchRace(id: number): Promise<GigaRace | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/racing/race/${id}`, { headers: { accept: "application/json" }, cache: "no-store", signal: ctl.signal });
    if (!res.ok) {
      if (res.status === 429) throw new Error("429"); // surfaces as throttle to the caller
      return null; // 404 or other: a successful round-trip, this id simply has no race (yet)
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

interface RefreshResult {
  lobbies: OpenLobby[];
  frontier: number;
  throttled: boolean; // at least one id 429'd
  successCount: number; // upstream round-trips that completed (incl. 404s); 0 means a real outage
}

async function refreshSnapshot(): Promise<RefreshResult> {
  const dbMax = await frontierMax();
  const center = Math.max(dbMax, frontierEst);

  // Prune the resolved set to the live window so it cannot grow without bound as the
  // frontier advances.
  const lowWatermark = center - WINDOW_BELOW;
  for (const id of resolved) if (id < lowWatermark) resolved.delete(id);

  const ids: number[] = [];
  for (let id = center - WINDOW_BELOW; id <= center + WINDOW_ABOVE; id++) {
    if (id > 0 && !resolved.has(id)) ids.push(id); // skip races already known resolved
  }

  const lobbies: OpenLobby[] = [];
  let throttled = false;
  let successCount = 0;
  let highestSeen = center;

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((id) => quickFetchRace(id).then((race) => ({ id, race }))));
    for (const r of results) {
      if (r.status === "rejected") { throttled = true; continue; } // a 429 on this id; the rest still count
      successCount++;
      const { id, race } = r.value;
      if (!race || !race.success) continue; // 404 or empty: nothing here yet
      if (id > highestSeen) highestSeen = id; // a real race exists here, so the frontier is at least this high
      if (race.phase !== 1) { resolved.add(id); continue; } // running or resolved: never re-forms, stop re-fetching it
      const fieldSize = race.fieldSize ?? 0;
      const entries = race.entries ?? [];
      const petCount = entries.length;
      const openSlots = fieldSize - petCount;
      if (fieldSize <= 0 || openSlots <= 0) continue; // no field size or already full
      if (petCount < 1) continue; // empty shell: the field has not formed, never surface it as a real lobby
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
  frontierEst = highestSeen; // walk the frontier up toward the live edge for the next refresh
  return { lobbies, frontier: highestSeen, throttled, successCount };
}

async function doRefresh(): Promise<void> {
  try {
    const snap = await refreshSnapshot();
    if (snap.successCount > 0) {
      // Any successful upstream round-trip means we just observed the current
      // frontier: refresh the snapshot and clear delayed, even if a few ids 429'd.
      // This is what guarantees recovery; the cache can never freeze while we can
      // still reach upstream at all.
      cache = { lobbies: snap.lobbies, fetchedAt: Date.now(), frontier: snap.frontier };
      delayed = false;
      ttl = snap.throttled ? MILD_BACKOFF_MS : FRESH_MS; // ease off briefly if partly throttled, else full cadence
    } else {
      // Zero successful fetches: a genuine outage or hard throttle. Keep the last
      // snapshot, flag delayed, and back off the retry cadence.
      delayed = true;
      ttl = DEGRADED_MS;
    }
  } catch {
    // frontierMax (DB) or an unexpected error: degrade, keep the last snapshot.
    delayed = true;
    ttl = DEGRADED_MS;
  }
}

// Returns the current snapshot. Serves a cached snapshot instantly and kicks off at
// most one background refresh when stale (stale-while-revalidate); only the very
// first call, with no cache yet, awaits the refresh. Past the staleness ceiling the
// snapshot is no longer treated as live: we return no lobbies (flagged delayed) so
// an old, possibly empty field is never rendered as if it were current.
export async function getOpenLobbies(): Promise<{ lobbies: OpenLobby[]; fetchedAt: number | null; delayed: boolean }> {
  const now = Date.now();
  const stale = !cache || now - cache.fetchedAt >= ttl;
  if (stale && !inflight) inflight = doRefresh().finally(() => { inflight = null; });
  if (!cache && inflight) await inflight; // first load blocks until we have data

  const fetchedAt = cache?.fetchedAt ?? null;
  const age = cache ? now - cache.fetchedAt : Infinity;
  if (age > STALE_CEILING_MS) {
    // Honesty ceiling: this snapshot is too old to call live. Do not serve its
    // lobbies (their fields and edge would be fiction); show the delayed state until
    // a fresh fetch lands. fetchedAt is still returned so the indicator reads true.
    return { lobbies: [], fetchedAt, delayed: true };
  }
  return { lobbies: cache?.lobbies ?? [], fetchedAt, delayed };
}
