// Reproducible derivation of the Stable Skill Score constants from live data.
// A stable's skill score is the empirical-Bayes-shrunk average confirmed quality
// of its PROVEN horses:
//   stable_avg  = mean(proven cq)
//   SKILL_SCORE = (n * stable_avg + K * POP_MEAN) / (n + K)
// POP_MEAN and K are NOT hardcoded. POP_MEAN is the mean cq across all proven
// horses. K is the smallest shrinkage strength at which single-lucky-horse flukes
// stop contaminating the top of the board: sweep K, pick the smallest K that
// yields 0 stables with <= 2 proven horses in the top 10 (ranked over ALL stables
// with >= 1 proven, so the flukes can appear and then be shrunk out).
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

console.log("loading pets + pet_scores ...");
const pets = await loadAll<{ id: number; owner_address: string | null }>("pets", "id, owner_address", "id");
const scores = await loadAll<{ pet_id: number; confirmed_quality: number | null }>("pet_scores", "pet_id, confirmed_quality", "pet_id");

const ownerById = new Map(pets.map((p) => [p.id, p.owner_address]));

// 1. Detect the floor: the modal cq, shared by the large unrevealed mass (cq does
//    not depend on rarity, so every fully-unrevealed never-raced horse is identical).
const freq = new Map<number, number>();
for (const s of scores) {
  if (s.confirmed_quality == null) continue;
  const v = Number(s.confirmed_quality);
  freq.set(v, (freq.get(v) ?? 0) + 1);
}
let floor = 0, floorN = 0;
for (const [v, n] of freq) if (n > floorN) { floor = v; floorN = n; }
const EPS = 0.05; // proven is meaningfully above the shared floor constant
console.log(`floor (modal cq) = ${floor} shared by ${floorN} horses (${(100 * floorN / scores.length).toFixed(1)}% of population)`);

// show the cq distribution just above the floor, to confirm a clean separation
const justAbove = [...freq.entries()].filter(([v]) => v > floor && v <= floor + 3).sort((a, b) => a[0] - b[0]).slice(0, 6);
console.log("cq values just above floor:", justAbove.map(([v, n]) => `${v.toFixed(3)}(${n})`).join(", "));

// 2. Proven horses + POP_MEAN
type Proven = { petId: number; cq: number; owner: string };
const proven: Proven[] = [];
for (const s of scores) {
  if (s.confirmed_quality == null) continue;
  const cq = Number(s.confirmed_quality);
  if (cq <= floor + EPS) continue; // not proven: at or below the unrevealed floor
  const owner = ownerById.get(s.pet_id);
  if (!owner) continue;
  proven.push({ petId: s.pet_id, cq, owner: owner.toLowerCase() });
}
const POP_MEAN = proven.reduce((a, p) => a + p.cq, 0) / proven.length;
console.log(`proven horses = ${proven.length} (${(100 * proven.length / scores.length).toFixed(1)}% of population)`);
console.log(`POP_MEAN (mean cq over proven) = ${POP_MEAN.toFixed(4)}`);

// 3. Stables: proven horses grouped by owner
const stables = new Map<string, number[]>();
for (const p of proven) {
  const l = stables.get(p.owner) ?? [];
  l.push(p.cq);
  stables.set(p.owner, l);
}
const totalHorsesByOwner = new Map<string, number>();
for (const p of pets) { const o = p.owner_address?.toLowerCase(); if (o) totalHorsesByOwner.set(o, (totalHorsesByOwner.get(o) ?? 0) + 1); }

const stableList = [...stables.entries()].map(([owner, cqs]) => {
  const n = cqs.length;
  const avg = cqs.reduce((a, b) => a + b, 0) / n;
  return { owner, n, avg };
});
const eligible = stableList.filter((s) => s.n >= 3);
console.log(`stables with >=1 proven = ${stableList.length}; with >=3 proven (board-eligible) = ${eligible.length}`);

// 4. Sweep K: rank ALL stables with >=1 proven, count top-10 flukes (<=2 proven)
const score = (n: number, avg: number, K: number) => (n * avg + K * POP_MEAN) / (n + K);
console.log("\nK sweep (rank over all >=1-proven stables):");
console.log("   K | top10 with <=2 proven | min provenCount in top10");
let chosenK: number | null = null;
for (let K = 1; K <= 20; K++) {
  const ranked = [...stableList].sort((a, b) => score(b.n, b.avg, K) - score(a.n, a.avg, K));
  const top10 = ranked.slice(0, 10);
  const flukes = top10.filter((s) => s.n <= 2).length;
  const minProven = Math.min(...top10.map((s) => s.n));
  console.log(`  ${String(K).padStart(2)} | ${String(flukes).padStart(21)} | ${String(minProven).padStart(24)}`);
  if (chosenK === null && flukes === 0) chosenK = K;
}
console.log(`\nCHOSEN K = ${chosenK} (smallest K with 0 stables of <=2 proven in the top 10)`);

// 5. Show the board-eligible top 10 at the chosen K, for a believability spot-check
const K = chosenK ?? 10;
const board = eligible.map((s) => ({ ...s, score: score(s.n, s.avg, K) })).sort((a, b) => b.score - a.score);
console.log(`\nBoard-eligible top 10 at K=${K} (percentile = rank / ${eligible.length}):`);
console.log("  rank  owner            proven  avgCq   score   pct");
board.slice(0, 10).forEach((s, i) => {
  const pct = (100 * (i + 1) / eligible.length).toFixed(1);
  console.log(`  ${String(i + 1).padStart(4)}  ${s.owner.slice(0, 14)}  ${String(s.n).padStart(6)}  ${s.avg.toFixed(1).padStart(5)}  ${s.score.toFixed(2).padStart(6)}  top ${pct}%`);
});

console.log(`\nSUMMARY: floor=${floor.toFixed(3)} POP_MEAN=${POP_MEAN.toFixed(2)} K=${chosenK} eligible(>=3)=${eligible.length}`);
