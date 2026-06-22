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
  adjustedShipped: boolean; // false if the adjustment failed its out-of-sample check
  minCell: number;
  factors: Record<string, number>; // `${track}|${temp}` -> multiplier on raw ms
  validation: { tracksTested: number; tracksImproved: number; note: string };
  tracks: number[]; // tracks with enough records to show, sorted ascending
  byTrack: Record<number, Record<Win, { raw: RecordEntry[]; adjusted: RecordEntry[] }>>;
}

export interface RecordsResult {
  tracks: number;
  adjustedShipped: boolean;
  validation: { tracksTested: number; tracksImproved: number };
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

// Out-of-sample check: fit factors on a deterministic 70% of races, and on the
// held-out 30% confirm the temp-median spread per track shrinks after adjustment.
function validate(winners: Pt[], tracks: number[]): { tracksTested: number; tracksImproved: number } {
  const train = winners.filter((w) => w.raceId % 10 < 7);
  const test = winners.filter((w) => w.raceId % 10 >= 7);
  const f = deriveFactors(train, tracks);
  let tested = 0, improved = 0;
  for (const track of tracks) {
    const raw: number[] = [], adj: number[] = [];
    let cells = 0;
    for (const temp of TEMPS) {
      const ms = test.filter((w) => w.track === track && w.temp === temp).map((w) => w.ms);
      if (ms.length < 10) continue;
      cells++;
      raw.push(median(ms));
      adj.push(median(ms.map((x) => x * (f[`${track}|${temp}`] ?? 1))));
    }
    if (cells < 2) continue;
    tested++;
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    if (spread(adj) < spread(raw)) improved++;
  }
  return { tracksTested: tested, tracksImproved: improved };
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
  const v = validate(winners, allTracks);
  const adjustedShipped = v.tracksTested > 0 && v.tracksImproved > v.tracksTested / 2;

  const adj = (p: Pt) => p.ms * (factors[`${p.track}|${p.temp}`] ?? 1);
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

  const blob: RacingRecordsBlob = {
    computedAt: new Date().toISOString(),
    referenceCondition: REFERENCE,
    adjustedShipped,
    minCell: MIN_CELL,
    factors,
    validation: { ...v, note: `Adjusted is more comparable on held-out data in ${v.tracksImproved} of ${v.tracksTested} tracks.` },
    tracks,
    byTrack,
  };
  await setSyncState("racing_records_v1", blob);
  return { tracks: tracks.length, adjustedShipped, validation: v };
}
