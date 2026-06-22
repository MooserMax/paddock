import { db } from "../db";
import { setSyncState } from "../syncState";

// Stable Skill Score, computed in the scheduled job and written to
// sync_state['stable_skill_v1'] for instant reads. A stable's score is the
// empirical-Bayes-shrunk average confirmed quality of its PROVEN horses:
//   stable_avg  = mean(proven cq)
//   SKILL_SCORE = (n * stable_avg + K * POP_MEAN) / (n + K)
// POP_MEAN and K are recomputed from live data every run (they drift as horses
// reveal). The K derivation is reproduced here and audited by
// scripts/derive-stable-skill-k.mts. Proven = cq meaningfully above the modal
// unrevealed floor (cq does not depend on rarity, so every fully-unrevealed
// never-raced horse shares one floor value). Depth (proven count) is stored and
// displayed separately, never folded into the score.

const PROVEN_EPS = 0.05; // proven is meaningfully above the shared floor constant
const MIN_PROVEN_RANKED = 3; // comps-or-silence: 3+ proven to appear on the public board

// One eligible (>=3 proven) stable, stored sorted desc by score.
export interface StableBoardEntry {
  address: string;
  provenCount: number;
  totalHorses: number;
  avgProvenCq: number;
  score: number;
  topPetId: number | null; // highest-cq proven horse, the card's anchor
  topPetCq: number | null; // that horse's confirmed quality
}
// A 1-2 proven stable, scored but not ranked (limited data).
export interface StableLimitedEntry {
  provenCount: number;
  totalHorses: number;
  avgProvenCq: number;
  score: number;
  topPetId: number | null;
  topPetCq: number | null;
}
export interface StableSkillBlob {
  computedAt: string;
  floor: number;
  popMean: number;
  k: number;
  provenPop: number;
  eligibleTotal: number;
  board: StableBoardEntry[];
  limited: Record<string, StableLimitedEntry>;
  // cq value at each top-percentile of the FULL horse population, so a horse's
  // confirmed quality can be reported as its real standing (e.g. top 0.1%)
  // without any assumed maximum. Sorted most exclusive first.
  cqThresholds: { pct: number; cq: number }[];
}

export interface StableSkillResult {
  popMean: number;
  k: number;
  floor: number;
  eligibleTotal: number;
  provenPop: number;
}

async function loadAll<T>(table: string, cols: string, orderCol: string): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from(table).select(cols).order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`stable-skill ${table} load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export async function materializeStableSkill(): Promise<StableSkillResult> {
  const pets = await loadAll<{ id: number; owner_address: string | null }>("pets", "id, owner_address", "id");
  const scores = await loadAll<{ pet_id: number; confirmed_quality: number | null }>("pet_scores", "pet_id, confirmed_quality", "pet_id");
  const ownerById = new Map(pets.map((p) => [p.id, p.owner_address?.toLowerCase() ?? null]));

  // 1. Floor: the modal cq, shared by the large unrevealed mass.
  const freq = new Map<number, number>();
  for (const s of scores) {
    if (s.confirmed_quality == null) continue;
    freq.set(Number(s.confirmed_quality), (freq.get(Number(s.confirmed_quality)) ?? 0) + 1);
  }
  let floor = 0, floorN = -1;
  for (const [v, n] of freq) if (n > floorN) { floor = v; floorN = n; }

  // 2. Proven horses (cq meaningfully above the floor) + POP_MEAN.
  const proven: { petId: number; cq: number; owner: string }[] = [];
  for (const s of scores) {
    if (s.confirmed_quality == null) continue;
    const cq = Number(s.confirmed_quality);
    if (cq <= floor + PROVEN_EPS) continue;
    const owner = ownerById.get(s.pet_id);
    if (!owner) continue;
    proven.push({ petId: s.pet_id, cq, owner });
  }
  const popMean = proven.length ? proven.reduce((a, p) => a + p.cq, 0) / proven.length : floor;

  // 3. Group proven horses by stable; track the top-cq horse per stable.
  const byOwner = new Map<string, { cqs: number[]; topCq: number; topPet: number | null }>();
  for (const p of proven) {
    const e = byOwner.get(p.owner) ?? { cqs: [], topCq: -1, topPet: null };
    e.cqs.push(p.cq);
    if (p.cq > e.topCq) { e.topCq = p.cq; e.topPet = p.petId; }
    byOwner.set(p.owner, e);
  }
  const totalByOwner = new Map<string, number>();
  for (const p of pets) { const o = p.owner_address?.toLowerCase(); if (o) totalByOwner.set(o, (totalByOwner.get(o) ?? 0) + 1); }

  const stables = [...byOwner.entries()].map(([address, e]) => {
    const n = e.cqs.length;
    const avg = e.cqs.reduce((a, b) => a + b, 0) / n;
    return { address, n, avg, topPet: e.topPet, topCq: e.topCq, total: totalByOwner.get(address) ?? n };
  });

  // cq thresholds over the FULL population, so a horse's quality reports its real
  // standing (top 0.1%, etc.) with no assumed maximum. Marks are most exclusive
  // first; a horse maps to the most exclusive mark its cq clears.
  const allCq = scores.map((s) => Number(s.confirmed_quality ?? 0)).sort((a, b) => b - a);
  const PCT_MARKS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.05];
  const cqThresholds = PCT_MARKS.map((pct) => ({ pct, cq: round(allCq[Math.floor(pct * allCq.length)] ?? allCq[0] ?? 0, 2) }));

  // 4. Derive K: smallest K with 0 stables of <=2 proven in the top 10, ranked
  //    over ALL stables with >=1 proven so flukes can appear and be shrunk out.
  const score = (n: number, avg: number, K: number) => (n * avg + K * popMean) / (n + K);
  let k = 9;
  for (let cand = 1; cand <= 20; cand++) {
    const top10 = [...stables].sort((a, b) => score(b.n, b.avg, cand) - score(a.n, a.avg, cand)).slice(0, 10);
    if (top10.every((s) => s.n > 2)) { k = cand; break; }
  }

  // 5. Build the eligible board (>=3 proven, sorted desc) and the limited map.
  const eligible = stables
    .filter((s) => s.n >= MIN_PROVEN_RANKED)
    .map((s) => ({ address: s.address, provenCount: s.n, totalHorses: s.total, avgProvenCq: round(s.avg, 2), score: round(score(s.n, s.avg, k), 3), topPetId: s.topPet, topPetCq: round(s.topCq, 2) }))
    .sort((a, b) => b.score - a.score);
  const limited: Record<string, StableLimitedEntry> = {};
  for (const s of stables) {
    if (s.n >= MIN_PROVEN_RANKED) continue;
    limited[s.address] = { provenCount: s.n, totalHorses: s.total, avgProvenCq: round(s.avg, 2), score: round(score(s.n, s.avg, k), 3), topPetId: s.topPet, topPetCq: round(s.topCq, 2) };
  }

  const blob: StableSkillBlob = {
    computedAt: new Date().toISOString(),
    floor: round(floor, 3),
    popMean: round(popMean, 3),
    k,
    provenPop: proven.length,
    eligibleTotal: eligible.length,
    board: eligible,
    limited,
    cqThresholds,
  };
  await setSyncState("stable_skill_v1", blob);
  return { popMean: blob.popMean, k, floor: blob.floor, eligibleTotal: eligible.length, provenPop: proven.length };
}

function round(x: number, p: number): number {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}
