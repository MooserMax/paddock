import { RARITY_TIERS, type Rarity } from "./duelRules";

// OFFICIAL Gigaverse breeding odds, from the game's /duel Info tabs. These are the AUTHORITATIVE
// priors; the empirical fit (duelModel) is demoted to a validation layer (observed vs expected).
//
// Source + verification: the Info-tab prose (Mutate / Inherit / Fill selection, Host Favour, the
// deglue/reglue glue economy, Faction Dust, "the challenger always takes the Duelborn") was
// confirmed verbatim in the live /duel client bundle this session. The exact numeric cells are
// computed at runtime in the minified SPA and could not be extracted as literals, so the tables
// below are transcribed from the published Info tabs and cross-checked against Paddock's own
// resolved-duel outcomes (e.g. Giga x Giga always Giga; ~94% same-tier hold) which agree. If a cell
// on the live page ever differs, the live page wins. Percentages are kept verbatim (minor rounding
// in the source is preserved).

const RARITY_IDX: Record<Rarity, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Relic: 5, Giga: 6 };
export const rarityName = (idx: number): string => RARITY_TIERS[idx] ?? `tier ${idx}`;

// Offspring tier distribution by parent-rarity pair, keyed "loIdx,hiIdx" (loIdx <= hiIdx). Each
// entry is [offspringRarityIdx, pct].
export const OFFICIAL_RARITY: Record<string, [number, number][]> = {
  "1,1": [[1, 96.9], [2, 3.1]],
  "1,2": [[1, 88.3], [2, 11.7]],
  "1,3": [[1, 75.5], [2, 17.5], [3, 7.0]],
  "1,4": [[1, 68.3], [2, 22.7], [3, 9.1]],
  "1,5": [[1, 62.3], [2, 26.9], [3, 10.8]],
  "1,6": [[1, 57.3], [2, 30.5], [3, 12.2]],
  "2,2": [[1, 4.2], [2, 93.3], [3, 2.5]],
  "2,3": [[1, 3.9], [2, 86.4], [3, 9.7]],
  "2,4": [[1, 3.4], [2, 75.7], [3, 14.9], [4, 6.0]],
  "2,5": [[1, 3.1], [2, 69.4], [3, 19.6], [4, 7.8]],
  "2,6": [[1, 2.9], [2, 64.1], [3, 23.6], [4, 9.4]],
  "3,3": [[2, 4.2], [3, 93.7], [4, 2.1]],
  "3,4": [[2, 4.0], [3, 87.9], [4, 8.1]],
  "3,5": [[2, 3.5], [3, 78.6], [4, 12.8], [5, 5.1]],
  "3,6": [[2, 3.3], [3, 73.0], [4, 17.0], [5, 6.8]],
  "4,4": [[3, 4.2], [4, 94.1], [5, 1.7]],
  "4,5": [[3, 4.0], [4, 89.5], [5, 6.5]],
  "4,6": [[3, 3.7], [4, 81.7], [5, 10.4], [6, 4.2]],
  "5,5": [[4, 4.3], [5, 94.5], [6, 1.2]],
  "5,6": [[4, 4.1], [5, 91.1], [6, 4.8]],
  "6,6": [[6, 100.0]],
};

export interface RarityDistItem { rarity: number; name: string; pct: number }

// Official offspring rarity distribution for a pairing (sorted most-likely first). Returns null if
// the pair is outside the published table (e.g. a Common parent), so callers can fall back.
export function officialRarityDist(rarityA: number, rarityB: number): RarityDistItem[] | null {
  const lo = Math.min(rarityA, rarityB), hi = Math.max(rarityA, rarityB);
  const cell = OFFICIAL_RARITY[`${lo},${hi}`];
  if (!cell) return null;
  return cell.map(([r, pct]) => ({ rarity: r, name: rarityName(r), pct })).sort((a, b) => b.pct - a.pct);
}

// Official P(offspring rarity > lower parent) for a pairing (the climb rate), and P(hold) at the
// lower parent. Null when the pair is off-table.
export function officialClimbPct(rarityA: number, rarityB: number): number | null {
  const lo = Math.min(rarityA, rarityB);
  const dist = officialRarityDist(rarityA, rarityB);
  if (!dist) return null;
  return Math.round(dist.filter((d) => d.rarity > lo).reduce((s, d) => s + d.pct, 0) * 10) / 10;
}
export function officialHoldPct(rarityA: number, rarityB: number): number | null {
  const lo = Math.min(rarityA, rarityB);
  const dist = officialRarityDist(rarityA, rarityB);
  if (!dist) return null;
  return Math.round((dist.find((d) => d.rarity === lo)?.pct ?? 0) * 10) / 10;
}

// Expected climb / hold rate across a set of real pairings [loIdx, hiIdx], weighted by the actual
// pairing mix in the dataset. Used for the observed-vs-official tiles.
export function expectedRateAcross(pairs: [number, number][], kind: "climb" | "hold"): { pct: number; n: number } {
  let sum = 0, n = 0;
  for (const [a, b] of pairs) {
    const v = kind === "climb" ? officialClimbPct(a, b) : officialHoldPct(a, b);
    if (v == null) continue;
    sum += v; n++;
  }
  return { pct: n ? Math.round((sum / n) * 10) / 10 : 0, n };
}

// TRAIT TIER INHERITANCE (official): parents' star tiers -> offspring tier odds [1-star, 2-star,
// 3-star]%, keyed "loTier,hiTier" (tiers 1..3). Applies only IF the trait is inherited; shared
// traits (both parents carry) are far more likely to be chosen, and higher-tier traits too. We
// never claim which slots fill; we frame everything as "if inherited".
export const OFFICIAL_TRAIT_TIER: Record<string, [number, number, number]> = {
  "1,1": [67, 27, 7],
  "1,2": [44, 44, 13],
  "1,3": [38, 28, 34],
  "2,2": [24, 59, 18],
  "2,3": [18, 44, 38],
  "3,3": [12, 29, 59],
};
export function officialTraitTierOdds(tierA: number, tierB: number): [number, number, number] | null {
  const lo = Math.min(tierA, tierB), hi = Math.max(tierA, tierB);
  return OFFICIAL_TRAIT_TIER[`${lo},${hi}`] ?? null;
}

// FACTION (official published outcomes). A natural parent stakes 35 of 100 toward its faction, a
// converted parent 15, Faction Dust +5 per influence; the unclaimed remainder rolls factionless.
// Gigus is never staked: the only Gigus Duelborn comes from a Gigus parent FALLING (then certain);
// a surviving Gigus parent donates its stake to the other faction.
export const FACTION_OUTCOMES = {
  sameNatural: "70/30 factionless",
  twoNatural: "35 / 35 / 30 factionless",
  factionVsFactionless: "35 / 65 factionless",
  bothConverted: "30 / 70 factionless",
  naturalPlus2Dust: "80 / 20 factionless",
} as const;

// GLUE ECONOMY (official): deglue yields and reglue costs by rarity index (Uncommon..Giga).
// Factionless pets pay double the normal glue; max 3 reglues per Gigling.
export const DEGLUE_YIELD = [0, 4, 8, 12, 24, 32, 40]; // indexed by rarity idx (0 Common unused)
export const REGLUE_COST = [0, 4, 4, 6, 6, 8, 8];
export function glueFor(rarityIdx: number): { deglueYield: number | null; reglueCost: number | null } {
  if (rarityIdx < 1 || rarityIdx >= DEGLUE_YIELD.length) return { deglueYield: null, reglueCost: null };
  return { deglueYield: DEGLUE_YIELD[rarityIdx], reglueCost: REGLUE_COST[rarityIdx] };
}

export { RARITY_IDX };
