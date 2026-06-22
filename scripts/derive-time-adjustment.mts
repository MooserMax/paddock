// Derive and VALIDATE the condition-adjustment for racing records, on Paddock's
// own DB (race_entries.finish_time_ms joined to races.race_temp/track_length/
// field_size). Mirrors scripts/derive-stable-skill-k.mts: imports from ../src,
// polite paginated loads, prints findings. Constants are derived, never hardcoded;
// the same logic runs live in src/lib/ingest/records.ts.
//
// Question: does normalizing a raw finish time for track conditions make times
// MORE comparable across conditions out of sample? If not, we ship raw only.
import { db } from "../src/lib/db";

async function loadAll<T>(table: string, cols: string, orderCol: string): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

const MIN_CELL = 30; // a (track, temp) cell needs this many winner times to be trusted
const TEMPS = ["hot", "average", "cold"] as const;

console.log("loading races + race_entries ...");
const races = await loadAll<{ race_id: number; track_length: number | null; race_temp: string | null; field_size: number | null; resolved: boolean }>(
  "races", "race_id, track_length, race_temp, field_size, resolved", "race_id");
const entries = await loadAll<{ race_id: number; finish_position: number | null; finish_time_ms: number | null }>(
  "race_entries", "race_id, finish_position, finish_time_ms", "race_id");

const raceById = new Map(races.map((r) => [r.race_id, r]));
// A clean datapoint: a finished entry with a positive time in a resolved race
// with a known track and a known temperature.
type Pt = { track: number; temp: string; field: number | null; pos: number; ms: number; raceId: number };
const pts: Pt[] = [];
for (const e of entries) {
  if (e.finish_time_ms == null || Number(e.finish_time_ms) <= 0 || e.finish_position == null) continue;
  const r = raceById.get(e.race_id);
  if (!r || !r.resolved || r.track_length == null || !r.race_temp) continue;
  if (!TEMPS.includes(r.race_temp as (typeof TEMPS)[number])) continue;
  pts.push({ track: r.track_length, temp: r.race_temp, field: r.field_size, pos: e.finish_position, ms: Number(e.finish_time_ms), raceId: e.race_id });
}
const winners = pts.filter((p) => p.pos === 1);
const tracks = [...new Set(pts.map((p) => p.track))].sort((a, b) => a - b);
console.log(`datapoints: ${pts.length} entries with times, ${winners.length} winners; tracks: ${tracks.join(", ")}`);
console.log(`minimum trusted cell size: ${MIN_CELL} winner times`);

// (2) Temperature effect per track, on winner times (position controlled).
console.log("\n(2) WINNER median time by (track, temp), and % vs average:");
console.log("  track | temp     |    n | median ms | vs average");
const cellMed = new Map<string, number>(); // `${track}|${temp}` -> median winner ms
const cellN = new Map<string, number>();
for (const track of tracks) {
  const avg = winners.filter((w) => w.track === track && w.temp === "average").map((w) => w.ms);
  const avgMed = median(avg);
  for (const temp of TEMPS) {
    const ms = winners.filter((w) => w.track === track && w.temp === temp).map((w) => w.ms);
    cellMed.set(`${track}|${temp}`, median(ms));
    cellN.set(`${track}|${temp}`, ms.length);
    const rel = Number.isFinite(avgMed) && avgMed > 0 && ms.length ? `${(((median(ms) - avgMed) / avgMed) * 100).toFixed(1)}%` : "n/a";
    const flag = ms.length < MIN_CELL ? " (thin)" : "";
    console.log(`  ${String(track).padStart(5)} | ${temp.padEnd(8)} | ${String(ms.length).padStart(4)} | ${Number.isFinite(median(ms)) ? median(ms).toFixed(0).padStart(9) : "      n/a"} | ${rel}${flag}`);
  }
}

// (3) Candidate confounds.
console.log("\n(3) CONFOUND TESTS:");
// field_size: within (track, average temp), does winner time vary with field size?
console.log("  field_size (within track + average temp), winner median by field:");
for (const track of tracks) {
  const byField = new Map<number, number[]>();
  for (const w of winners) if (w.track === track && w.temp === "average" && w.field != null) {
    const l = byField.get(w.field) ?? []; l.push(w.ms); byField.set(w.field, l);
  }
  const cells = [...byField.entries()].filter(([, v]) => v.length >= 10).sort((a, b) => a[0] - b[0]);
  if (cells.length >= 2) {
    const lo = cells[0], hi = cells[cells.length - 1];
    const spread = ((median(hi[1]) - median(lo[1])) / median(lo[1])) * 100;
    console.log(`    ${track}m: field ${lo[0]} med ${median(lo[1]).toFixed(0)} (n${lo[1].length}) vs field ${hi[0]} med ${median(hi[1]).toFixed(0)} (n${hi[1].length}), spread ${spread.toFixed(1)}%`);
  } else {
    console.log(`    ${track}m: too few field cells with adequate n`);
  }
}
// finish position: time spread by position (context, not a record-factor since records use a horse's own time).
console.log("  finish_position (overall median time by position, ratio to winner):");
const posMed = new Map<number, number[]>();
for (const p of pts) { const l = posMed.get(p.pos) ?? []; l.push(p.ms); posMed.set(p.pos, l); }
const win1 = median(posMed.get(1) ?? []);
for (const pos of [1, 2, 3, 4, 6, 8].filter((p) => posMed.has(p))) {
  console.log(`    pos ${pos}: median ${median(posMed.get(pos)!).toFixed(0)} (${(median(posMed.get(pos)!) / win1).toFixed(3)}x winner, n${posMed.get(pos)!.length})`);
}
console.log("  juiced: per-race item usage is not recorded on-chain (methodology), so it is not measurable from our data; excluded.");

// (4) Factors per (track, temp), reference = average. factor = avgMedian/tempMedian.
//     A hot time (fast) gets factor>1 (slowed to average-equivalent); cold gets factor<1.
function factorsFrom(sample: Pt[]) {
  const f = new Map<string, number>();
  for (const track of tracks) {
    const avgMed = median(sample.filter((w) => w.track === track && w.temp === "average").map((w) => w.ms));
    for (const temp of TEMPS) {
      const ms = sample.filter((w) => w.track === track && w.temp === temp).map((w) => w.ms);
      if (ms.length >= MIN_CELL && Number.isFinite(avgMed) && median(ms) > 0) f.set(`${track}|${temp}`, avgMed / median(ms));
    }
  }
  return f;
}
const factors = factorsFrom(winners);
console.log("\n(4) ADJUSTMENT FACTORS (reference = average temp), adjustedMs = rawMs * factor(track, temp):");
for (const [k, v] of [...factors.entries()].sort()) console.log(`    ${k} -> ${v.toFixed(4)}`);

// (5) OUT-OF-SAMPLE validation. Deterministic 70/30 split by race id. Fit factors
//     on train winners; on held-out test winners, does the hot-vs-cold spread of
//     median times shrink after adjustment vs raw? (per track with adequate cells)
const train = winners.filter((w) => w.raceId % 10 < 7);
const test = winners.filter((w) => w.raceId % 10 >= 7);
const trainF = factorsFrom(train);
console.log(`\n(5) OUT-OF-SAMPLE VALIDATION (train ${train.length} / test ${test.length} winners, factors fit on train):`);
console.log("  per track, max-min spread of temp medians as % of the average-temp median, RAW vs ADJUSTED on held-out test:");
let improvedTracks = 0, testedTracks = 0;
for (const track of tracks) {
  const tempMedRaw: number[] = [];
  const tempMedAdj: number[] = [];
  let adequate = 0;
  for (const temp of TEMPS) {
    const ms = test.filter((w) => w.track === track && w.temp === temp).map((w) => w.ms);
    if (ms.length < 10) continue;
    adequate++;
    tempMedRaw.push(median(ms));
    const f = trainF.get(`${track}|${temp}`) ?? 1;
    tempMedAdj.push(median(ms.map((x) => x * f)));
  }
  if (adequate < 2) { console.log(`    ${track}m: too few test cells`); continue; }
  testedTracks++;
  const base = mean(tempMedRaw);
  const spreadRaw = ((Math.max(...tempMedRaw) - Math.min(...tempMedRaw)) / base) * 100;
  const spreadAdj = ((Math.max(...tempMedAdj) - Math.min(...tempMedAdj)) / base) * 100;
  const better = spreadAdj < spreadRaw;
  if (better) improvedTracks++;
  console.log(`    ${track}m: raw spread ${spreadRaw.toFixed(2)}% -> adjusted ${spreadAdj.toFixed(2)}%  ${better ? "BETTER" : "worse"}`);
}
console.log(`\nVERDICT: adjusted is more comparable on held-out data in ${improvedTracks}/${testedTracks} tracks.`);
console.log(improvedTracks > testedTracks / 2
  ? "=> SHIP ADJUSTED (validated out of sample), reference = average temp, factors above."
  : "=> DO NOT SHIP ADJUSTED; ship raw only.");
