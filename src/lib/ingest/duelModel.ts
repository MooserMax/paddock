import { setSyncState } from "../syncState";
import { db } from "../db";
import { RARITY_TIERS } from "../duelRules";
import { hydrateMissingPets } from "./pets";

// Empirical duel-outcome model, fit from REAL resolved duels (the labeled dataset: parent A +
// parent B -> exact offspring, from GET /api/duel/listings). Every probability carries its sample
// size N. Where N is too thin, callers fall back to the documented rule and say so. Nothing here
// is a guessed table; it is measured from outcomes, and backtested against them. Read-only.
//
// Numeric rarity maps to the 7-tier ladder index (0=Common .. 6=Giga); observed duels span Rare
// (2) to Giga (6). Source + N + generatedAt are stored so the UI can show "modeled from N duels".
//
// HONESTY BOUNDARY (verified against the live set this session, N=69):
//   - Rarity holds at the lower parent in 63/69, climbs in 3, slips in 3. Modellable per pair.
//   - Stat FLOOR is a clean deterministic function of offspring rarity: (rarity - 1) * 10
//     (Rare 10, Epic 20, Legendary 30, Relic 40, Giga 50). Near-lookup, backed by per-tier N.
//   - Generation = round(avg(parent gens)) + 1 (69/69). Gender = the Fallen's sex (69/69).
//   - Faction = a parent's faction 62/69.
//   - The FALL is CHOSEN via Host Favour (aggressionBps), not forced by duels-left: aggr 10000 ->
//     the challenger falls (46/46), aggr 0 -> the host falls (21/21); the middle (5000) has only
//     n=2 and is a coin flip, so contested odds are NOT modellable. forcedFinalDuel makes the
//     forced pet the Fallen with certainty.
//   - Offspring TRAITS and EXACT STATS are unrevealed at mint (every offspring has racesRun 0), so
//     they are NOT predicted. Only the rarity floor and the ceiling (100) are stated.

const LISTINGS_API = "https://gigaverse.io/api/duel/listings";

export const DUEL_MODEL_KEY = "duel_model_v1";
export const DUEL_TRAINING_KEY = "duel_training_v1";

interface Rng { min?: number | null; max?: number | null }
interface Trait { id?: string | null; name?: string | null; tier?: number | null }
interface RPub { startRange?: Rng; speedRange?: Rng; staminaRange?: Rng; finishRange?: Rng; revealsPerStat?: Record<string, number>; elo?: number; traits?: Trait[] }
interface DuelPet { id?: number; sex?: string; rarity?: number; generation?: number; factionId?: number; duelsLeft?: number; racesRun?: number; racePublic?: RPub }
interface Listing {
  listingId?: number; phaseName?: string; aggressionBps?: number; forcedFinalDuel?: boolean; priceWei?: string; templateName?: string;
  hostPetId?: number; challengerPetId?: number; loserPetId?: number; survivorPetId?: number;
  hostPet?: DuelPet; challengerPet?: DuelPet; offspring?: DuelPet;
}

async function getJson(url: string, tries = 5): Promise<{ listings?: Listing[]; pageInfo?: { hasMore?: boolean; nextCursor?: string | null } }> {
  for (let a = 0; a < tries; a++) {
    try { return (await (await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" })).json()) as never; }
    catch (e) { if (a === tries - 1) throw e; await new Promise((s) => setTimeout(s, 400 * (a + 1))); }
  }
  return {};
}

// Paginate the whole feed until hasMore is false (never truncate as the set grows). The 200-page
// cap is only a runaway guard; today the resolved set is a handful of pages.
async function fetchAllResolved(maxPages = 200): Promise<Listing[]> {
  const out: Listing[] = []; let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const j = await getJson(`${LISTINGS_API}?limit=20${cursor ? `&cursor=${cursor}` : ""}`);
    out.push(...(j.listings ?? []));
    if (!j.pageInfo?.hasMore || !j.pageInfo?.nextCursor) break;
    cursor = j.pageInfo.nextCursor;
  }
  return out.filter((l) => l.phaseName === "RESOLVED" && l.offspring?.id != null);
}

const mid = (r?: Rng) => (r && r.min != null && r.max != null ? (r.min + r.max) / 2 : null);

// The single most notable trait a parent carries, for the teaching feed and the pairing "why":
// prefer Surger (the study's dominant trait), else the highest-tier trait.
function topTrait(p?: DuelPet): string | null {
  const traits = (p?.racePublic?.traits ?? []).filter((t) => t && t.id);
  if (traits.length === 0) return null;
  const surger = traits.find((t) => t.id === "surger");
  if (surger) return surger.name ?? "Surger";
  const best = traits.slice().sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0];
  return best?.name ?? null;
}

export interface RarityCell { offsets: Record<string, number>; total: number } // offset from the lower parent rarity

export interface DuelModel {
  n: number;
  source: string;
  rarity: { byPair: Record<string, RarityCell>; holdRate: number };
  // Offspring stat-range minimum by offspring rarity index. Observed clean: (rarity - 1) * 10.
  statFloor: Record<string, { floor: number; n: number }>;
  // Accuracy of each DATA-BACKED prediction, backtested against the resolved set itself.
  backtest: {
    rarity: { correct: number; n: number };      // predict offspring rarity = lower parent rarity
    generation: { correct: number; n: number };  // round(avg(parent gens)) + 1
    gender: { correct: number; n: number };       // offspring sex = the Fallen's sex
    faction: { correct: number; n: number };      // offspring faction = one parent's faction
    statFloor: { correct: number; n: number };    // observed floor = (offspring rarity - 1) * 10
  };
  // The fall is chosen via Host Favour; store the observed extremes so the UI can state certainty.
  fall: { byAgg: Record<string, { hostFell: number; chalFell: number; n: number }>; n: number; note: string };
  faction: { inheritRate: number; n: number };
  stats: { meanSignedDiff: number; sd: number; n: number; offspringRevealed: boolean; rangeFittable: boolean };
  traits: { observable: boolean; note: string };
  // Median real sale price (ETH) by rarity tier index, from our sales+pets data, with per-tier N.
  rarityValueEth: Record<string, { medianEth: number; n: number }>;
  generatedAt: string;
}

// Median sale price (ETH) per rarity tier, from the sales table joined to pet rarity. Real data;
// thin tiers carry a low N so the UI can caveat or interpolate.
async function fitRarityValues(): Promise<Record<string, { medianEth: number; n: number }>> {
  const out: Record<string, { medianEth: number; n: number }> = {};
  try {
    const { data: sales } = await db().from("sales").select("token_id, price_eth").not("price_eth", "is", null).order("sold_at", { ascending: false }).limit(2000);
    const rows = (sales ?? []) as { token_id: number; price_eth: number }[];
    const ids = [...new Set(rows.map((r) => r.token_id))];
    const rarityById = new Map<number, number>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data: pets } = await db().from("pets").select("id, rarity").in("id", ids.slice(i, i + 500));
      for (const p of (pets ?? []) as { id: number; rarity: number | null }[]) if (p.rarity != null) rarityById.set(p.id, p.rarity);
    }
    const byTier: Record<number, number[]> = {};
    for (const r of rows) { const rar = rarityById.get(r.token_id); if (rar == null) continue; (byTier[rar] ??= []).push(Number(r.price_eth)); }
    for (const [tier, arr] of Object.entries(byTier)) {
      arr.sort((a, b) => a - b);
      out[tier] = { medianEth: arr[Math.floor(arr.length / 2)], n: arr.length };
    }
  } catch { /* sales/pets unavailable: leave empty, valuation marks itself pending */ }
  return out;
}

// ---- Training set (Part 1): every resolved duel as a compact labeled row -------------------

export interface DuelTrainingParent { petId: number; rarity: number | null; sex: string | null; topTrait: string | null }
export interface DuelTrainingRow {
  listingId: number;
  host: DuelTrainingParent;
  challenger: DuelTrainingParent;
  offspring: { petId: number; rarity: number | null; sex: string | null; generation: number | null };
  loserPetId: number | null; survivorPetId: number | null;
  forcedFinalDuel: boolean; priceWei: string; aggressionBps: number;
  lowerParentRarity: number | null; // min(host, challenger), for hold/climb/slip tagging
}
export interface DuelTraining {
  n: number;
  rows: DuelTrainingRow[];
  aggregates: {
    rarity: { hold: number; climb: number; slip: number; n: number };
    paid: { count: number; totalWei: string; avgWei: string };
    forced: { count: number };
  };
  generatedAt: string;
}

function trainingParent(p?: DuelPet): DuelTrainingParent {
  return { petId: Number(p?.id ?? 0), rarity: p?.rarity ?? null, sex: p?.sex ?? null, topTrait: topTrait(p) };
}

function buildTraining(R: Listing[]): DuelTraining {
  const rows: DuelTrainingRow[] = [];
  let hold = 0, climb = 0, slip = 0, rarN = 0;
  let paidCount = 0, paidTotal = 0n, forced = 0;
  for (const l of R) {
    const a = l.hostPet?.rarity ?? null, b = l.challengerPet?.rarity ?? null, o = l.offspring?.rarity ?? null;
    const lo = a != null && b != null ? Math.min(a, b) : null;
    if (lo != null && o != null) { rarN++; if (o > lo) climb++; else if (o < lo) slip++; else hold++; }
    const pw = BigInt(l.priceWei ?? "0");
    if (pw > 0n) { paidCount++; paidTotal += pw; }
    if (l.forcedFinalDuel) forced++;
    rows.push({
      listingId: Number(l.listingId ?? 0),
      host: trainingParent(l.hostPet),
      challenger: trainingParent(l.challengerPet),
      offspring: { petId: Number(l.offspring?.id ?? 0), rarity: o, sex: l.offspring?.sex ?? null, generation: l.offspring?.generation ?? null },
      loserPetId: l.loserPetId ?? null, survivorPetId: l.survivorPetId ?? null,
      forcedFinalDuel: !!l.forcedFinalDuel, priceWei: (l.priceWei ?? "0").toString(), aggressionBps: l.aggressionBps ?? 0,
      lowerParentRarity: lo,
    });
  }
  rows.sort((a, b) => b.listingId - a.listingId);
  return {
    n: R.length,
    rows,
    aggregates: {
      rarity: { hold, climb, slip, n: rarN },
      paid: { count: paidCount, totalWei: paidTotal.toString(), avgWei: (paidCount ? paidTotal / BigInt(paidCount) : 0n).toString() },
      forced: { count: forced },
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function fitDuelModel(): Promise<DuelModel> {
  const R = await fetchAllResolved();
  const n = R.length;

  // RARITY: per (lo,hi) parent-rarity pair, distribution of (offspring - lo). Backtest = the rule
  // "offspring rarity equals the lower parent" against the set.
  const byPair: Record<string, RarityCell> = {};
  let rarityCorrect = 0, rarityN = 0;
  for (const l of R) {
    const a = l.hostPet?.rarity, b = l.challengerPet?.rarity, o = l.offspring?.rarity;
    if (a == null || b == null || o == null) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b), off = o - lo;
    const key = `${lo},${hi}`;
    const cell = (byPair[key] ??= { offsets: {}, total: 0 });
    cell.offsets[off] = (cell.offsets[off] ?? 0) + 1; cell.total++;
    rarityN++; if (o === lo) rarityCorrect++;
  }

  // STAT FLOOR: min of the offspring's four stat-range minima, grouped by offspring rarity. The
  // observed value is deterministic per tier; store the modal floor and per-tier N. Backtest the
  // (rarity - 1) * 10 rule.
  const floorSamples: Record<number, number[]> = {};
  let floorCorrect = 0, floorN = 0;
  for (const l of R) {
    const o = l.offspring; const rp = o?.racePublic; const rar = o?.rarity;
    if (rar == null || !rp) continue;
    const mins = [rp.startRange, rp.speedRange, rp.staminaRange, rp.finishRange].map((x) => x?.min).filter((x): x is number => x != null);
    if (mins.length === 0) continue;
    const floor = Math.min(...mins);
    (floorSamples[rar] ??= []).push(floor);
    floorN++; if (floor === (rar - 1) * 10) floorCorrect++;
  }
  const statFloor: Record<string, { floor: number; n: number }> = {};
  for (const [rar, arr] of Object.entries(floorSamples)) {
    // modal floor (the clean per-tier value); arr is near-constant in practice.
    const counts = new Map<number, number>();
    for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
    const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    statFloor[rar] = { floor: modal, n: arr.length };
  }

  // GENERATION: round(avg(parent gens)) + 1. GENDER: offspring sex = the Fallen's (loserPetId) sex.
  let genCorrect = 0, genN = 0, gndCorrect = 0, gndN = 0;
  for (const l of R) {
    const ga = l.hostPet?.generation, gb = l.challengerPet?.generation, go = l.offspring?.generation;
    if (ga != null && gb != null && go != null) { genN++; if (Math.round((ga + gb) / 2) + 1 === go) genCorrect++; }
    const loser = [l.hostPet, l.challengerPet].find((p) => p?.id === l.loserPetId);
    if (loser?.sex && l.offspring?.sex) { gndN++; if (loser.sex === l.offspring.sex) gndCorrect++; }
  }

  // FALL: observed faller by aggressionBps (Host Favour). Deterministic at the extremes.
  const byAgg: Record<string, { hostFell: number; chalFell: number; n: number }> = {};
  let fallN = 0;
  for (const l of R) {
    const agg = String(l.aggressionBps ?? "");
    const cell = (byAgg[agg] ??= { hostFell: 0, chalFell: 0, n: 0 });
    if (l.loserPetId === l.hostPetId) cell.hostFell++; else cell.chalFell++;
    cell.n++; fallN++;
  }

  // FACTION: offspring faction equals one parent's faction (the 100-pt pool leans to a parent).
  let facMatch = 0, facN = 0;
  for (const l of R) {
    const o = l.offspring?.factionId; if (o == null) continue; facN++;
    if (o === l.hostPet?.factionId || o === l.challengerPet?.factionId) facMatch++;
  }

  // STATS: signed (offspring - parent midpoint), pooled across the four stats. Offspring stats are
  // unrevealed at mint, so the SD is reveal noise, not inheritance spread; the 95% range is NOT
  // fittable and is flagged.
  let sum = 0, sumsq = 0, statN = 0, anyRevealed = false;
  for (const l of R) {
    const orp = l.offspring?.racePublic;
    if (orp?.revealsPerStat && Object.values(orp.revealsPerStat).some((v) => (v ?? 0) > 0)) anyRevealed = true;
    for (const st of ["startRange", "speedRange", "staminaRange", "finishRange"] as const) {
      const a = mid(l.hostPet?.racePublic?.[st]), b = mid(l.challengerPet?.racePublic?.[st]), o = mid(orp?.[st]);
      if (a == null || b == null || o == null) continue;
      const d = o - (a + b) / 2; sum += d; sumsq += d * d; statN++;
    }
  }
  const meanSigned = statN ? sum / statN : 0;
  const sd = statN ? Math.sqrt(Math.max(0, sumsq / statN - meanSigned * meanSigned)) : 0;

  const rarityValueEth = await fitRarityValues();

  const model: DuelModel = {
    n,
    source: "Gigaverse resolved duels (GET /api/duel/listings)",
    rarity: { byPair, holdRate: rarityN ? rarityCorrect / rarityN : 0 },
    statFloor,
    backtest: {
      rarity: { correct: rarityCorrect, n: rarityN },
      generation: { correct: genCorrect, n: genN },
      gender: { correct: gndCorrect, n: gndN },
      faction: { correct: facMatch, n: facN },
      statFloor: { correct: floorCorrect, n: floorN },
    },
    fall: {
      byAgg, n: fallN,
      note: "The fall is chosen via Host Favour (aggressionBps): 10000 (max) fells the challenger, 0 fells the host, both deterministic in the data; the middle has too few contested duels to model. A forced final duel fells the forced pet with certainty.",
    },
    faction: { inheritRate: facN ? facMatch / facN : 0, n: facN },
    stats: { meanSignedDiff: Math.round(meanSigned * 100) / 100, sd: Math.round(sd * 100) / 100, n: statN, offspringRevealed: anyRevealed, rangeFittable: anyRevealed },
    traits: { observable: false, note: "Offspring traits are hidden at birth and reveal only as it races; they cannot be predicted from current data (every offspring in the set has racesRun 0)." },
    rarityValueEth,
    generatedAt: new Date().toISOString(),
  };
  await setSyncState(DUEL_MODEL_KEY, model);

  // Store the per-row training set (Part 1) and hydrate any duel pet missing from our pets table
  // (Part 0 backfill: offspring + parents that appear in a duel but were never synced as racers).
  const training = buildTraining(R);
  await setSyncState(DUEL_TRAINING_KEY, training);
  const petIds: number[] = [];
  for (const row of training.rows) { petIds.push(row.host.petId, row.challenger.petId, row.offspring.petId); if (row.loserPetId) petIds.push(row.loserPetId); if (row.survivorPetId) petIds.push(row.survivorPetId); }
  try { await hydrateMissingPets(petIds); } catch { /* hydration is best-effort; the model still stands */ }

  return model;
}

// Typical ETH value for a rarity tier (nearest non-empty tier if the exact one is thin/empty).
export function rarityValue(model: DuelModel | null, rarity: number): { medianEth: number | null; n: number } {
  if (!model) return { medianEth: null, n: 0 };
  const exactCell = model.rarityValueEth[String(rarity)];
  if (exactCell && exactCell.n >= 2) return exactCell;
  let best: { medianEth: number; n: number } | null = null, bestDist = Infinity;
  for (const [k, v] of Object.entries(model.rarityValueEth)) {
    const d = Math.abs(Number(k) - rarity);
    if (v.n >= 2 && d < bestDist) { bestDist = d; best = v; }
  }
  return best ? { medianEth: best.medianEth, n: best.n } : { medianEth: exactCell?.medianEth ?? null, n: exactCell?.n ?? 0 };
}

// ---- Prediction from the fitted model (pure, used by the preview + recommender) ------------

export interface RarityPrediction { distribution: { rarity: number; name: string; pct: number }[]; mostLikely: number; n: number; basis: "data" | "documented" }

// Predict offspring rarity distribution for two parent rarities, from the empirical per-pair
// table when N >= 5, else the documented rule (centered on the lower parent, capped climb, small
// slip) with basis flagged as thin.
export function predictRarity(model: DuelModel | null, rarityA: number, rarityB: number): RarityPrediction {
  const lo = Math.min(rarityA, rarityB), hi = Math.max(rarityA, rarityB);
  const cell = model?.rarity.byPair[`${lo},${hi}`];
  const name = (idx: number) => RARITY_TIERS[idx] ?? `tier ${idx}`;
  if (cell && cell.total >= 5) {
    const dist = Object.entries(cell.offsets)
      .map(([off, c]) => ({ rarity: lo + Number(off), name: name(lo + Number(off)), pct: Math.round((c / cell.total) * 100) }))
      .sort((a, b) => b.pct - a.pct);
    return { distribution: dist, mostLikely: dist[0].rarity, n: cell.total, basis: "data" };
  }
  // Documented fallback: ~85% at the lower parent, ~10% climb +1 (capped below the higher), ~5% slip.
  const climbCap = Math.min(lo + 1, hi);
  const dist = [
    { rarity: lo, name: name(lo), pct: 85 },
    ...(climbCap > lo ? [{ rarity: climbCap, name: name(climbCap), pct: 10 }] : []),
    ...(lo > 0 ? [{ rarity: lo - 1, name: name(lo - 1), pct: 5 }] : []),
  ].sort((a, b) => b.pct - a.pct);
  return { distribution: dist, mostLikely: lo, n: cell?.total ?? 0, basis: "documented" };
}

// Offspring stat-range minimum for a given offspring rarity: a near-deterministic lookup with the
// per-tier sample count; falls back to the observed (rarity - 1) * 10 rule where a tier is empty.
export function statFloorFor(model: DuelModel | null, rarity: number): { floor: number | null; n: number } {
  const cell = model?.statFloor[String(rarity)];
  if (cell) return cell;
  return { floor: rarity >= 2 ? (rarity - 1) * 10 : null, n: 0 };
}

export interface FallPrediction { determined: boolean; faller: "host" | "challenger" | null; note: string; n: number }

// Who falls, given Host Favour (aggressionBps). Deterministic at the extremes (observed 46/46 and
// 21/21); the contested middle is honestly declared unmodellable.
export function predictFall(model: DuelModel | null, aggressionBps: number): FallPrediction {
  const cell = model?.fall.byAgg[String(aggressionBps)];
  if (aggressionBps >= 10000) return { determined: true, faller: "challenger", note: cell ? `Max Host Favour: the challenger falls (${cell.chalFell}/${cell.n} in data).` : "Max Host Favour: the challenger falls.", n: cell?.n ?? 0 };
  if (aggressionBps <= 0) return { determined: true, faller: "host", note: cell ? `Min Host Favour: the host falls (${cell.hostFell}/${cell.n} in data).` : "Min Host Favour: the host falls.", n: cell?.n ?? 0 };
  return { determined: false, faller: null, note: "Outcome decided by the duel; not enough contested-duel data to model odds.", n: cell?.n ?? 0 };
}
