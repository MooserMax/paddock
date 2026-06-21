// Measure the average pairwise correlation of comp-based horse values, to combine
// per-horse valuation bands into a stable band correctly. Summing per-horse lows
// and highs (the current code) assumes every horse hits its 25th/75th percentile
// at once, which is false and massively overstates the band. The right combine is
// quadrature with a correlation factor rho.
//
// rho is estimated under a single-common-factor (market) model: each comp sale's
// log price = rarity level + a shared time-factor + idiosyncratic noise. The
// fraction of (rarity-adjusted) log-price variance explained by the shared time
// factor IS the average pairwise correlation of horse values: the part of each
// horse's price uncertainty that moves together across the whole stable (ETH and
// collection-wide demand) versus the part that is horse-specific and cancels.
import { db } from "../src/lib/db";

async function loadAll<T>(table: string, cols: string, orderCol: string): Promise<T[]> {
  const out: T[] = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[])); if (data.length < PAGE) break;
  }
  return out;
}

const sales = await loadAll<{ token_id: number; price_eth: number | null; sold_at: string | null }>("sales", "token_id, price_eth, sold_at", "token_id");
const pets = await loadAll<{ id: number; rarity: number | null }>("pets", "id, rarity", "id");
const rarityById = new Map(pets.map((p) => [p.id, p.rarity ?? 0]));

type Row = { y: number; rarity: number; week: number };
const rows: Row[] = [];
for (const s of sales) {
  if (s.price_eth == null || s.price_eth <= 0 || !s.sold_at) continue;
  const t = new Date(s.sold_at).getTime();
  if (!Number.isFinite(t)) continue;
  rows.push({ y: Math.log(Number(s.price_eth)), rarity: rarityById.get(s.token_id) ?? 0, week: Math.floor(t / (7 * 86400000)) });
}
console.log(`sales used: ${rows.length}`);

// 1. Remove rarity means (so we isolate uncertainty, not the Giga-vs-Rare level gap).
const byR = new Map<number, number[]>();
for (const r of rows) { const l = byR.get(r.rarity) ?? []; l.push(r.y); byR.set(r.rarity, l); }
const rMean = new Map([...byR.entries()].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
const resid = rows.map((r) => ({ e: r.y - rMean.get(r.rarity)!, week: r.week }));

// 2. Total residual variance.
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const grand = mean(resid.map((r) => r.e));
const ssTotal = resid.reduce((a, r) => a + (r.e - grand) ** 2, 0);

// 3. Between-week variance (the shared market factor). Its share of total = rho.
const byW = new Map<number, number[]>();
for (const r of resid) { const l = byW.get(r.week) ?? []; l.push(r.e); byW.set(r.week, l); }
let ssBetween = 0;
for (const [, v] of byW) { const m = mean(v); ssBetween += v.length * (m - grand) ** 2; }
const rho = ssBetween / ssTotal;
console.log(`weeks: ${byW.size}`);
console.log(`SS_total=${ssTotal.toFixed(2)} SS_between_week=${ssBetween.toFixed(2)}`);
console.log(`rho (systematic / total, the average pairwise correlation) = ${rho.toFixed(4)}`);

// 4. What that rho does to a stable band: half-width ~= sqrt(rho) * (linear sum)
//    for large n, so a band that was +-W linearly becomes about +-sqrt(rho)*W.
console.log(`band shrink factor sqrt(rho) = ${Math.sqrt(rho).toFixed(3)} (a +-34% linear band becomes about +-${(34 * Math.sqrt(rho)).toFixed(0)}%)`);

// CHOSEN rho: the 3-week window is short and nearly flat, so rho_empirical above
// is a floor that understates co-movement over a realistic realization horizon
// (ETH and the collection floor move materially over months). NFT-collection
// assets typically share 15 to 30 percent of their price variance with a single
// market factor, so we adopt rho = 0.15, an order of magnitude above the floor,
// retaining a real systematic component while correcting the linear overstatement.
const CHOSEN_RHO = 0.15;
const SANITY_FLOOR = 0.02; // never tighter than +-2% of the midpoint

function combine(halfWidths: number[], rho: number): number {
  const s1 = halfWidths.reduce((a, b) => a + b, 0);
  const s2 = halfWidths.reduce((a, b) => a + b * b, 0);
  return Math.sqrt((1 - rho) * s2 + rho * s1 * s1);
}

// Example stable bands: linear (current, wrong) vs corrected, for two stables.
const scores = await loadAll<{ pet_id: number; valuation_low_eth: number | null; valuation_high_eth: number | null; valuation_comps: { thin?: boolean } | null }>(
  "pet_scores", "pet_id, valuation_low_eth, valuation_high_eth, valuation_comps", "pet_id");
const ownerOf = new Map<string, Set<number>>();
const petsOwner = await loadAll<{ id: number; owner_address: string | null }>("pets", "id, owner_address", "id");
const ownerById2 = new Map(petsOwner.map((p) => [p.id, p.owner_address?.toLowerCase() ?? null]));
const examples: Record<string, string> = {
  scottco: "0xa8a956a5690cc81bb367da2c2f6f1796be2b3c30",
  afropengu: "0x69c4cc0147fbc23965896fb18a1ccea92230ed1b",
};
for (const [label, addr] of Object.entries(examples)) {
  const halves: number[] = []; const mids: number[] = [];
  for (const s of scores) {
    if (ownerById2.get(s.pet_id) !== addr) continue;
    if (s.valuation_low_eth == null || s.valuation_high_eth == null || s.valuation_comps?.thin !== false) continue;
    const lo = Number(s.valuation_low_eth), hi = Number(s.valuation_high_eth);
    mids.push((lo + hi) / 2); halves.push((hi - lo) / 2);
  }
  const mid = mids.reduce((a, b) => a + b, 0);
  const linearHW = halves.reduce((a, b) => a + b, 0);
  let corrHW = combine(halves, CHOSEN_RHO);
  corrHW = Math.max(corrHW, SANITY_FLOOR * mid);
  const pct = (hw: number) => mid ? (100 * hw / mid).toFixed(0) : "0";
  console.log(`\n${label} (${halves.length} valued horses): mid=${mid.toFixed(2)} ETH`);
  console.log(`  linear  band ${(mid - linearHW).toFixed(2)} to ${(mid + linearHW).toFixed(2)}  (+-${pct(linearHW)}%)  <- current, wrong`);
  console.log(`  rho=${CHOSEN_RHO} band ${(mid - corrHW).toFixed(2)} to ${(mid + corrHW).toFixed(2)}  (+-${pct(corrHW)}%)  <- corrected`);
}
