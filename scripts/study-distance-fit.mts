// Out-of-sample validation of distance fit, in the same walk-forward spirit as
// the shark-flag and odds studies. Reproducible from Supabase.
//
// LEAKAGE NOTE: only CURRENT reveal state is stored (no per-race snapshots), so a
// strict "reveal state as of races before race R" is infeasible, the same limit
// the odds backtest documents. The honest handle: trackFit() depends ONLY on
// stats + traits, never on wins/elo/finish, so fit is NOT outcome-derived. For a
// FULLY-REVEALED horse, current fit equals the constant fit that held at every
// race it ran (its innate stats never changed; only our knowledge did), so for
// that subset current fit IS the point-in-time fit, with zero outcome leakage.
// PRIMARY = fully-revealed horses (leak-free). ROBUSTNESS = all entries, using
// the current best-estimate fit (not outcome leakage, only estimate precision).
import { db } from "../src/lib/db";
import { trackFit, revealProgress, STAT_KEYS, type PetInput } from "../src/lib/scoring/engine";

const TRACKS = [500, 1200, 2400, 3000] as const;

type Row = { rarity: number | null; races_run: number | null; max_races: number | null; wins: number | null;
  start_min: number | null; start_max: number | null; speed_min: number | null; speed_max: number | null;
  stamina_min: number | null; stamina_max: number | null; finish_min: number | null; finish_max: number | null;
  reveals_start: number | null; reveals_speed: number | null; reveals_stamina: number | null; reveals_finish: number | null; };

function toInput(r: Row, traits: { id: string; tier: number | null }[]): PetInput {
  return {
    rarity: r.rarity, racesRun: r.races_run, maxRaces: r.max_races, wins: r.wins,
    stats: {
      start: { min: r.start_min, max: r.start_max, reveals: r.reveals_start },
      speed: { min: r.speed_min, max: r.speed_max, reveals: r.reveals_speed },
      stamina: { min: r.stamina_min, max: r.stamina_max, reveals: r.reveals_stamina },
      finish: { min: r.finish_min, max: r.finish_max, reveals: r.reveals_finish },
    },
    traits,
  };
}

async function loadAll<T>(table: string, cols: string, order: string): Promise<T[]> {
  const out: T[] = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(cols).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

console.log("loading pets, traits, races, entries ...");
const petRows = await loadAll<Row & { id: number }>("pets",
  "id, rarity, races_run, max_races, wins, start_min, start_max, speed_min, speed_max, stamina_min, stamina_max, finish_min, finish_max, reveals_start, reveals_speed, reveals_stamina, reveals_finish", "id");
const traitRows = await loadAll<{ pet_id: number; trait_id: string; tier: number | null }>("pet_traits", "pet_id, trait_id, tier", "pet_id");
const raceRows = await loadAll<{ race_id: number; track_length: number | null }>("races", "race_id, track_length", "race_id");
// resolved entries only: finish_position present
const entryRows = await loadAll<{ race_id: number; pet_id: number; finish_position: number | null }>("race_entries", "race_id, pet_id, finish_position", "race_id");

const traitsByPet = new Map<number, { id: string; tier: number | null }[]>();
for (const t of traitRows) { const l = traitsByPet.get(t.pet_id) ?? []; l.push({ id: t.trait_id, tier: t.tier }); traitsByPet.set(t.pet_id, l); }

// Compute fit + reveal once per pet.
type PetFit = { fit: Record<number, number>; best: number; bestFit: number; minFit: number; spread: number; statReveal: number };
const petFit = new Map<number, PetFit>();
for (const p of petRows) {
  const input = toInput(p, traitsByPet.get(p.id) ?? []);
  const { fit, best } = trackFit(input);
  const rev = revealProgress(input);
  const vals = TRACKS.map((t) => fit[t]);
  petFit.set(p.id, { fit, best, bestFit: Math.max(...vals), minFit: Math.min(...vals), spread: Math.max(...vals) - Math.min(...vals), statReveal: rev.stats });
}

const trackByRace = new Map<number, number>();
for (const r of raceRows) if (r.track_length && (TRACKS as readonly number[]).includes(r.track_length)) trackByRace.set(r.race_id, r.track_length);

// Group entries by race, keep only races with a known track and >=2 finishers.
const byRace = new Map<number, { pet: number; pos: number }[]>();
for (const e of entryRows) {
  if (e.finish_position == null) continue;
  if (!trackByRace.has(e.race_id)) continue;
  const l = byRace.get(e.race_id) ?? []; l.push({ pet: e.pet_id, pos: e.finish_position }); byRace.set(e.race_id, l);
}

type Obs = { pet: number; track: number; fitAtTrack: number; shortfallAbs: number; shortfallRatio: number; isBest: boolean; pctile: number; reveal: number };
const obs: Obs[] = [];
let racesUsed = 0;
for (const [raceId, ents] of byRace) {
  const N = ents.length;
  if (N < 2) continue;
  racesUsed++;
  const track = trackByRace.get(raceId)!;
  for (const e of ents) {
    const pf = petFit.get(e.pet);
    if (!pf) continue;
    const fitAtTrack = pf.fit[track];
    const shortfallAbs = pf.bestFit - fitAtTrack;
    const shortfallRatio = pf.spread > 1e-6 ? shortfallAbs / pf.spread : 0;
    const pctile = (e.pos - 1) / (N - 1); // 0 = first (best), 1 = last (worst)
    obs.push({ pet: e.pet, track, fitAtTrack, shortfallAbs, shortfallRatio, isBest: shortfallAbs < 0.5, pctile, reveal: pf.statReveal });
  }
}

// Leave-one-out within-horse demeaning: penalty = pctile - mean(pctile of the
// horse's OTHER races), so horse quality is removed and a race never baselines
// against its own outcome. Needs >=2 races for that horse in the sample.
function withPenalty(set: Obs[]): (Obs & { penalty: number | null })[] {
  const sum = new Map<number, number>(); const cnt = new Map<number, number>();
  for (const o of set) { sum.set(o.pet, (sum.get(o.pet) ?? 0) + o.pctile); cnt.set(o.pet, (cnt.get(o.pet) ?? 0) + 1); }
  return set.map((o) => {
    const c = cnt.get(o.pet)!; const loo = c >= 2 ? (sum.get(o.pet)! - o.pctile) / (c - 1) : null;
    return { ...o, penalty: loo == null ? null : o.pctile - loo };
  });
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function fmt(x: number, d = 3): string { return Number.isFinite(x) ? x.toFixed(d) : "n/a"; }

function report(label: string, set: Obs[]) {
  const wp = withPenalty(set);
  console.log(`\n================ ${label}  (entries=${set.length}, horses=${new Set(set.map((o) => o.pet)).size}) ================`);

  // (a) gradient: mean finish percentile by fit-at-track decile + correlation
  console.log("\n(a) GRADIENT  fit-at-track decile -> mean finish percentile (lower=better)  [confounded by horse quality]");
  const sorted = [...set].sort((a, b) => a.fitAtTrack - b.fitAtTrack);
  const dec = 10; console.log("  decile  n     meanFit  meanFinishPctile");
  for (let i = 0; i < dec; i++) {
    const lo = Math.floor((i * sorted.length) / dec), hi = Math.floor(((i + 1) * sorted.length) / dec);
    const slice = sorted.slice(lo, hi); if (!slice.length) continue;
    console.log(`  ${String(i + 1).padStart(2)}      ${String(slice.length).padStart(5)}  ${fmt(mean(slice.map((o) => o.fitAtTrack)), 1)}    ${fmt(mean(slice.map((o) => o.pctile)))}`);
  }
  console.log(`  Pearson r(fitAtTrack, finishPctile) = ${fmt(pearson(set.map((o) => o.fitAtTrack), set.map((o) => o.pctile)))}  (negative = higher fit finishes better)`);

  // (b) shortfall buckets: absolute point gap, and spread-normalized ratio.
  // demeaned penalty (LOO) is the quality-controlled signal: positive = finishes
  // WORSE than the horse's own norm when raced at this shortfall.
  const absBuckets: [string, (o: Obs) => boolean][] = [
    ["[0,2)", (o) => o.shortfallAbs < 2], ["[2,5)", (o) => o.shortfallAbs >= 2 && o.shortfallAbs < 5],
    ["[5,10)", (o) => o.shortfallAbs >= 5 && o.shortfallAbs < 10], ["[10,15)", (o) => o.shortfallAbs >= 10 && o.shortfallAbs < 15],
    ["[15,20)", (o) => o.shortfallAbs >= 15 && o.shortfallAbs < 20], ["[20+)", (o) => o.shortfallAbs >= 20],
  ];
  console.log("\n(b1) SHORTFALL (absolute fit points below own best)  -> finish penalty");
  console.log("  bucket    n      rawFinishPctile   demeanedPenalty(LOO)   nDemean");
  for (const [name, pred] of absBuckets) {
    const s = wp.filter((o) => pred(o)); if (!s.length) continue;
    const dem = s.filter((o) => o.penalty != null).map((o) => o.penalty as number);
    console.log(`  ${name.padEnd(8)}  ${String(s.length).padStart(5)}   ${fmt(mean(s.map((o) => o.pctile)))}            ${fmt(mean(dem))}                ${dem.length}`);
  }
  const ratioBuckets: [string, (o: Obs) => boolean][] = [
    ["co-best", (o) => o.shortfallAbs < 0.5], ["(0,0.2]", (o) => o.shortfallAbs >= 0.5 && o.shortfallRatio <= 0.2],
    ["(0.2,0.4]", (o) => o.shortfallAbs >= 0.5 && o.shortfallRatio > 0.2 && o.shortfallRatio <= 0.4],
    ["(0.4,0.6]", (o) => o.shortfallRatio > 0.4 && o.shortfallRatio <= 0.6],
    ["(0.6,0.8]", (o) => o.shortfallRatio > 0.6 && o.shortfallRatio <= 0.8],
    ["(0.8,1.0]", (o) => o.shortfallRatio > 0.8],
  ];
  console.log("\n(b2) SHORTFALL RATIO (gap as fraction of own fit spread)  -> finish penalty");
  console.log("  bucket     n      meanGapPts  rawFinishPctile   demeanedPenalty(LOO)   nDemean");
  for (const [name, pred] of ratioBuckets) {
    const s = wp.filter((o) => pred(o)); if (!s.length) continue;
    const dem = s.filter((o) => o.penalty != null).map((o) => o.penalty as number);
    console.log(`  ${name.padEnd(9)}  ${String(s.length).padStart(5)}   ${fmt(mean(s.map((o) => o.shortfallAbs)), 1).padStart(6)}      ${fmt(mean(s.map((o) => o.pctile)))}            ${fmt(mean(dem))}                ${dem.length}`);
  }

  // (c) bestDistance check
  const best = wp.filter((o) => o.isBest), off = wp.filter((o) => !o.isBest);
  const bestDem = best.filter((o) => o.penalty != null).map((o) => o.penalty as number);
  const offDem = off.filter((o) => o.penalty != null).map((o) => o.penalty as number);
  console.log("\n(c) bestDistance check  (is argmax-fit where horses actually finish best?)");
  console.log(`  at bestDistance:  n=${best.length}  rawFinishPctile=${fmt(mean(best.map((o) => o.pctile)))}  demeanedPenalty=${fmt(mean(bestDem))}`);
  console.log(`  off best:         n=${off.length}  rawFinishPctile=${fmt(mean(off.map((o) => o.pctile)))}  demeanedPenalty=${fmt(mean(offDem))}`);
  // per-horse: fraction whose best-distance mean finish beats their off-best mean
  const byPet = new Map<number, { best: number[]; off: number[] }>();
  for (const o of wp) { const r = byPet.get(o.pet) ?? { best: [], off: [] }; (o.isBest ? r.best : r.off).push(o.pctile); byPet.set(o.pet, r); }
  let nHorses = 0, betterAtBest = 0;
  for (const [, r] of byPet) { if (r.best.length >= 2 && r.off.length >= 2) { nHorses++; if (mean(r.best) < mean(r.off)) betterAtBest++; } }
  console.log(`  per-horse (>=2 races at best AND >=2 off): ${betterAtBest}/${nHorses} = ${fmt(nHorses ? betterAtBest / nHorses : NaN, 3)} finish best at their bestDistance`);
}

console.log(`\nresolved races with known track + >=2 finishers used: ${racesUsed}`);

// Reveal distribution: how revealed are entrants' stats? Used to pick the
// closest-to-leak-free subset (the more revealed, the closer current fit is to
// the constant race-time fit, since stats are innate and reveals are outcome-
// independent milestone events).
const revs = obs.map((o) => o.reveal).sort((a, b) => a - b);
const q = (p: number) => revs[Math.floor(p * (revs.length - 1))];
console.log(`\nstat-reveal distribution over entries: min=${fmt(revs[0])} p25=${fmt(q(0.25))} median=${fmt(q(0.5))} p75=${fmt(q(0.75))} p90=${fmt(q(0.9))} max=${fmt(revs[revs.length - 1])}`);
const hiCut = q(0.66);
console.log(`high-reveal tertile cutoff (>= p66): statReveal >= ${fmt(hiCut)}`);

report("MAIN: ALL ENTRIES (fit is outcome-independent, so this is honest; caveat is estimate precision, not leakage)", obs);
report(`CLOSEST-TO-LEAK-FREE: HIGH-REVEAL TERTILE (statReveal >= ${fmt(hiCut)})`, obs.filter((o) => o.reveal >= hiCut));
report("LOW-REVEAL TERTILE (for contrast)", obs.filter((o) => o.reveal < q(0.33)));
