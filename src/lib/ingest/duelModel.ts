import { setSyncState } from "../syncState";
import { db } from "../db";
import { RARITY_TIERS } from "../duelRules";

// Empirical duel-outcome model, fit from REAL resolved duels (the labeled dataset: parent A +
// parent B -> exact offspring, from GET /api/duel/listings). Every probability carries its sample
// size N. Where N is too thin, callers fall back to the documented rule and say so. Nothing here
// is a guessed table; it is measured from outcomes, and backtested against them. Read-only.
//
// Numeric rarity maps to the 7-tier ladder index (0=Common .. 6=Giga); observed duels span Rare
// (2) to Giga (6). Source + N + generatedAt are stored so the UI can show "modeled from N duels".

const LISTINGS_API = "https://gigaverse.io/api/duel/listings";

export const DUEL_MODEL_KEY = "duel_model_v1";

interface Rng { min?: number | null; max?: number | null }
interface RPub { startRange?: Rng; speedRange?: Rng; staminaRange?: Rng; finishRange?: Rng; revealsPerStat?: Record<string, number>; elo?: number }
interface DuelPet { id?: number; sex?: string; rarity?: number; generation?: number; factionId?: number; duelsLeft?: number; racesRun?: number; racePublic?: RPub }
interface Listing {
  phaseName?: string; aggressionBps?: number; forcedFinalDuel?: boolean;
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

async function fetchAllResolved(maxPages = 12): Promise<Listing[]> {
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

export interface RarityCell { offsets: Record<string, number>; total: number } // offset from the lower parent rarity
export interface DuelModel {
  n: number;
  source: string;
  rarity: { byPair: Record<string, RarityCell>; backtest: { exact: number; within1: number; n: number } };
  fall: { byAgg: Record<string, { hostSurvived: number; n: number }>; rule: string; n: number };
  faction: { inheritRate: number; n: number };
  stats: { meanSignedDiff: number; sd: number; n: number; offspringRevealed: boolean; rangeFittable: boolean };
  traits: { observable: boolean; note: string };
  // Median real sale price (ETH) by rarity tier index, from our sales+pets data, with per-tier N.
  // Used for the value-burned / value-gained estimate. Empty tiers fall back to neighbours.
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

export async function fitDuelModel(): Promise<DuelModel> {
  const R = await fetchAllResolved();
  const n = R.length;

  // RARITY: per (lo,hi) parent-rarity pair, distribution of (offspring - lo). Plus backtest.
  const byPair: Record<string, RarityCell> = {};
  let exact = 0, within1 = 0, rarityN = 0;
  for (const l of R) {
    const a = l.hostPet?.rarity, b = l.challengerPet?.rarity, o = l.offspring?.rarity;
    if (a == null || b == null || o == null) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b), off = o - lo;
    const key = `${lo},${hi}`;
    const cell = (byPair[key] ??= { offsets: {}, total: 0 });
    cell.offsets[off] = (cell.offsets[off] ?? 0) + 1; cell.total++;
    rarityN++; if (o === lo) exact++; if (Math.abs(o - lo) <= 1) within1++;
  }

  // FALL: host-survival rate by aggressionBps (free-outcome only; forced duels are deterministic).
  const byAgg: Record<string, { hostSurvived: number; n: number }> = {};
  let fallN = 0;
  for (const l of R) {
    if (l.forcedFinalDuel) continue;
    const agg = String(l.aggressionBps ?? "");
    const hostSurv = l.survivorPetId === l.hostPetId ? 1 : 0;
    const b = (byAgg[agg] ??= { hostSurvived: 0, n: 0 });
    b.hostSurvived += hostSurv; b.n++; fallN++;
  }

  // FACTION: offspring faction equals one parent's faction (the 100-pt pool leans to a parent).
  let facMatch = 0, facN = 0;
  for (const l of R) {
    const o = l.offspring?.factionId; if (o == null) continue; facN++;
    if (o === l.hostPet?.factionId || o === l.challengerPet?.factionId) facMatch++;
  }

  // STATS: signed (offspring - parent midpoint) pooled across the four stats. Mean ~0 confirms the
  // center is the midpoint; but offspring stats are unrevealed at mint, so the SD is reveal noise,
  // not inheritance spread, and the 95% range is NOT fittable yet (flagged).
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
    rarity: { byPair, backtest: { exact, within1, n: rarityN } },
    fall: { byAgg, rule: "host survival rate = aggressionBps / 10000 (Host Favour); deterministic at 0% and 100%", n: fallN },
    faction: { inheritRate: facN ? facMatch / facN : 0, n: facN },
    stats: { meanSignedDiff: Math.round(meanSigned * 100) / 100, sd: Math.round(sd * 100) / 100, n: statN, offspringRevealed: anyRevealed, rangeFittable: anyRevealed },
    traits: { observable: false, note: "Offspring traits are unrevealed at mint, so trait inheritance is not yet measurable; documented rule only (Inherit most slots, small Mutate chance, Fill if parents run out)." },
    rarityValueEth,
    generatedAt: new Date().toISOString(),
  };
  await setSyncState(DUEL_MODEL_KEY, model);
  return model;
}

// Typical ETH value for a rarity tier (nearest non-empty tier if the exact one is thin/empty).
export function rarityValue(model: DuelModel | null, rarity: number): { medianEth: number | null; n: number } {
  if (!model) return { medianEth: null, n: 0 };
  const exactCell = model.rarityValueEth[String(rarity)];
  if (exactCell && exactCell.n >= 2) return exactCell;
  // nearest tier with data
  let best: { medianEth: number; n: number } | null = null, bestDist = Infinity;
  for (const [k, v] of Object.entries(model.rarityValueEth)) {
    const d = Math.abs(Number(k) - rarity);
    if (v.n >= 2 && d < bestDist) { bestDist = d; best = v; }
  }
  return best ? { medianEth: best.medianEth, n: best.n } : { medianEth: exactCell?.medianEth ?? null, n: exactCell?.n ?? 0 };
}

// ---- Prediction from the fitted model (pure, used by the preview) -------------------------

export interface RarityPrediction { distribution: { rarity: number; name: string; pct: number }[]; mostLikely: number; n: number; basis: "data" | "documented" }

// Predict offspring rarity distribution for two parent rarities, from the empirical per-pair
// table when N is sufficient, else the documented rule (centered on lower parent, capped climb,
// small slip) with basis flagged.
export function predictRarity(model: DuelModel | null, rarityA: number, rarityB: number): RarityPrediction {
  const lo = Math.min(rarityA, rarityB), hi = Math.max(rarityA, rarityB);
  const cell = model?.rarity.byPair[`${lo},${hi}`];
  const name = (idx: number) => RARITY_TIERS[idx] ?? `tier ${idx}`;
  if (cell && cell.total >= 4) {
    const dist = Object.entries(cell.offsets)
      .map(([off, c]) => ({ rarity: lo + Number(off), name: name(lo + Number(off)), pct: Math.round((c / cell.total) * 100) }))
      .sort((a, b) => b.pct - a.pct);
    return { distribution: dist, mostLikely: dist[0].rarity, n: cell.total, basis: "data" };
  }
  // Documented fallback: ~80% at the lower parent, ~12% climb +1 (capped below the higher), ~8% slip -1.
  const climbCap = Math.min(lo + 1, hi);
  const dist = [
    { rarity: lo, name: name(lo), pct: 80 },
    ...(climbCap > lo ? [{ rarity: climbCap, name: name(climbCap), pct: 12 }] : []),
    ...(lo > 0 ? [{ rarity: lo - 1, name: name(lo - 1), pct: 8 }] : []),
  ].sort((a, b) => b.pct - a.pct);
  return { distribution: dist, mostLikely: lo, n: cell?.total ?? 0, basis: "documented" };
}

// Fall prediction: who falls, given Host Favour (aggressionBps). Deterministic at the extremes.
export function predictFall(model: DuelModel | null, aggressionBps: number): { hostSurvivalPct: number; basis: "data" | "rule"; n: number } {
  const agg = String(aggressionBps);
  const cell = model?.fall.byAgg[agg];
  if (cell && cell.n >= 3) return { hostSurvivalPct: Math.round((cell.hostSurvived / cell.n) * 100), basis: "data", n: cell.n };
  return { hostSurvivalPct: Math.round((aggressionBps / 10000) * 100), basis: "rule", n: cell?.n ?? 0 };
}
