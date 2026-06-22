import { db } from "../db";
import { setSyncState } from "../syncState";

// Racing records, computed in a scheduled job and written to
// sync_state['racing_records_v1'] for instant reads. Modeled on stableSkill.ts:
// the same loadAll() paginated pattern and round() helper, the adjustment factors
// recomputed from live data every run, and a validation gate that ships adjusted
// times ONLY when they are more comparable across conditions out of sample.
//
// A Gigling's record at a distance is its lowest time there across resolved
// races. We keep both the best RAW time and the best ADJUSTED time (these can be
// different races), with the condition each was set in. Adjustment normalizes a
// raw time to "average" track temperature so a fast time in hot conditions is not
// ranked above an equally fast time set in neutral ones. See
// scripts/derive-time-adjustment.mts for the derivation and validation.

const MIN_CELL = 30; // a (track, temp) cell needs this many winner times to earn a factor
const MIN_TRACK_RECORDS = 10; // a track needs this many distinct record holders to be shown
const BOARD_CAP = 100; // top N per track, window, and mode
const TAIL_Q = 0.1; // the board shows the fastest, so validate the fastest-decile spread
const MIN_TEST = 15; // a held-out (track, temp) cell needs this many to be checked
const TEMPS = ["hot", "average", "cold"] as const;
const REFERENCE = "average";
const DAY_MS = 86_400_000;

export interface RecordEntry {
  petId: number;
  rawTimeMs: number;
  adjustedTimeMs: number;
  raceTemp: string;
  raceId: number;
  resolvedAt: string | null;
}
type Mode = "raw" | "adjusted";
type Win = "all" | "weekly" | "daily";

export interface RacingRecordsBlob {
  computedAt: string;
  referenceCondition: string;
  adjustedShipped: boolean; // true if the adjustment is board-fair on at least one track
  adjustmentApplied: Record<number, boolean>; // per track: did the condition adjustment pass the board gate
  minCell: number;
  factors: Record<string, number>; // `${track}|${temp}` -> multiplier on raw ms
  validation: { tracksTested: number; tracksApplied: number; note: string };
  tracks: number[]; // tracks with enough records to show, sorted ascending
  byTrack: Record<number, Record<Win, { raw: RecordEntry[]; adjusted: RecordEntry[] }>>;
}

export interface RecordsResult {
  tracks: number;
  adjustedShipped: boolean;
  validation: { tracksTested: number; tracksApplied: number };
}

async function loadAll<T>(table: string, cols: string, orderCol: string): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`records ${table} load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

const median = (a: number[]): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Pt = { petId: number; track: number; temp: string; pos: number; ms: number; raceId: number; resolvedAt: string | null; at: number };

// Factors per (track, temp), reference = average: factor = avgMedian / tempMedian,
// derived from winner times so finish position does not confound it. A hot time
// (fast) gets factor > 1 (slowed to the average-condition equivalent).
function deriveFactors(winners: Pt[], tracks: number[]): Record<string, number> {
  const f: Record<string, number> = {};
  for (const track of tracks) {
    const avgMed = median(winners.filter((w) => w.track === track && w.temp === REFERENCE).map((w) => w.ms));
    for (const temp of TEMPS) {
      const ms = winners.filter((w) => w.track === track && w.temp === temp).map((w) => w.ms);
      if (ms.length >= MIN_CELL && Number.isFinite(avgMed) && median(ms) > 0) f[`${track}|${temp}`] = avgMed / median(ms);
    }
  }
  return f;
}

const pctile = (a: number[], q: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// Board-relevant out-of-sample gate, per track. The board shows the FASTEST
// times, so we validate the TAIL, not the median: fit factors on 70% of races,
// and on the held-out 30% confirm the cross-condition spread of the fastest decile
// shrinks. A track is APPLIED only if it has a full set of factors AND the tail
// spread strictly improves; otherwise it ships RAW with an honest note. This is
// stricter than a median check, which can leave the extremes skewed. Returns the
// set of board-fair tracks and the count tested, for the validation summary.
function boardFairTracks(winners: Pt[], tracks: number[]): { applied: Set<number>; tested: number } {
  const train = winners.filter((w) => w.raceId % 10 < 7);
  const test = winners.filter((w) => w.raceId % 10 >= 7);
  const f = deriveFactors(train, tracks);
  const applied = new Set<number>();
  let tested = 0;
  for (const track of tracks) {
    const hasFactors = TEMPS.every((t) => f[`${track}|${t}`] != null);
    const tailRaw: number[] = [], tailAdj: number[] = [];
    for (const temp of TEMPS) {
      const ms = test.filter((w) => w.track === track && w.temp === temp).map((w) => w.ms);
      if (ms.length < MIN_TEST) continue;
      tailRaw.push(pctile(ms, TAIL_Q));
      tailAdj.push(pctile(ms.map((x) => x * (f[`${track}|${temp}`] ?? 1)), TAIL_Q));
    }
    if (!hasFactors || tailRaw.length < 2) continue;
    tested++;
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    if (spread(tailAdj) < spread(tailRaw)) applied.add(track);
  }
  return { applied, tested };
}

export async function materializeRecords(): Promise<RecordsResult> {
  const races = await loadAll<{ race_id: number; track_length: number | null; race_temp: string | null; resolved: boolean; resolved_at: string | null }>(
    "races", "race_id, track_length, race_temp, resolved, resolved_at", "race_id");
  const entries = await loadAll<{ race_id: number; pet_id: number; finish_position: number | null; finish_time_ms: number | null }>(
    "race_entries", "race_id, pet_id, finish_position, finish_time_ms", "race_id");
  const raceById = new Map(races.map((r) => [r.race_id, r]));

  const pts: Pt[] = [];
  for (const e of entries) {
    if (e.finish_time_ms == null || Number(e.finish_time_ms) <= 0 || e.finish_position == null) continue;
    const r = raceById.get(e.race_id);
    if (!r || !r.resolved || r.track_length == null || !r.race_temp) continue;
    if (!TEMPS.includes(r.race_temp as (typeof TEMPS)[number])) continue;
    const at = r.resolved_at ? new Date(r.resolved_at).getTime() : NaN;
    pts.push({ petId: e.pet_id, track: r.track_length, temp: r.race_temp, pos: e.finish_position, ms: Number(e.finish_time_ms), raceId: e.race_id, resolvedAt: r.resolved_at, at });
  }

  const allTracks = [...new Set(pts.map((p) => p.track))];
  const winners = pts.filter((p) => p.pos === 1);
  const factors = deriveFactors(winners, allTracks);
  const { applied, tested } = boardFairTracks(winners, allTracks);
  const adjustedShipped = applied.size > 0;

  // Apply the factor only on board-fair tracks; everywhere else adjusted == raw,
  // and the track is marked not-applied so the UI shows raw with the honest note.
  const adj = (p: Pt) => (applied.has(p.track) ? p.ms * (factors[`${p.track}|${p.temp}`] ?? 1) : p.ms);
  const toEntry = (p: Pt): RecordEntry => ({
    petId: p.petId,
    rawTimeMs: Math.round(p.ms),
    adjustedTimeMs: Math.round(adj(p)),
    raceTemp: p.temp,
    raceId: p.raceId,
    resolvedAt: p.resolvedAt,
  });

  const now = Date.now();
  const cutoff: Record<Win, number> = { all: -Infinity, weekly: now - 7 * DAY_MS, daily: now - DAY_MS };

  // Per pet, the single best (lowest) datapoint in a given mode, within a window.
  const bestBoard = (pool: Pt[], mode: Mode): RecordEntry[] => {
    const key = mode === "raw" ? (p: Pt) => p.ms : (p: Pt) => adj(p);
    const best = new Map<number, Pt>();
    for (const p of pool) {
      const cur = best.get(p.petId);
      if (!cur || key(p) < key(cur)) best.set(p.petId, p);
    }
    return [...best.values()].sort((a, b) => key(a) - key(b)).slice(0, BOARD_CAP).map(toEntry);
  };

  const tracks: number[] = [];
  const byTrack: RacingRecordsBlob["byTrack"] = {};
  for (const track of allTracks.sort((a, b) => a - b)) {
    const trackPts = pts.filter((p) => p.track === track);
    const distinctHolders = new Set(trackPts.map((p) => p.petId)).size;
    if (distinctHolders < MIN_TRACK_RECORDS) continue; // not enough records to rank
    tracks.push(track);
    const windows = {} as Record<Win, { raw: RecordEntry[]; adjusted: RecordEntry[] }>;
    for (const w of ["all", "weekly", "daily"] as Win[]) {
      const pool = w === "all" ? trackPts : trackPts.filter((p) => Number.isFinite(p.at) && p.at >= cutoff[w]);
      windows[w] = { raw: bestBoard(pool, "raw"), adjusted: bestBoard(pool, "adjusted") };
    }
    byTrack[track] = windows;
  }

  const adjustmentApplied: Record<number, boolean> = {};
  for (const track of tracks) adjustmentApplied[track] = applied.has(track);
  const tracksApplied = tracks.filter((t) => applied.has(t)).length;

  const blob: RacingRecordsBlob = {
    computedAt: new Date().toISOString(),
    referenceCondition: REFERENCE,
    adjustedShipped,
    adjustmentApplied,
    minCell: MIN_CELL,
    factors,
    validation: {
      tracksTested: tested,
      tracksApplied,
      note: `Temperature adjustment is applied on ${tracksApplied} track${tracksApplied === 1 ? "" : "s"} where it reduces the cross-condition spread of the fastest times out of sample. It reduces, but does not fully remove, condition effects, so the condition is always shown. Other tracks ship raw.`,
    },
    tracks,
    byTrack,
  };
  await setSyncState("racing_records_v1", blob);
  return { tracks: tracks.length, adjustedShipped, validation: { tracksTested: tested, tracksApplied } };
}
