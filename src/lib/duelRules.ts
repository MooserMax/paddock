// Deterministic Gigling breeding (duel) rules. ONLY the mechanics that are certain or known-math
// live here; probabilistic outputs that need the off-chain odds model (rarity %, stat 95% ranges,
// trait star-tiers) are deliberately NOT computed and are surfaced as "pending the odds model".
// Verified against 50 real resolved duels this session (gender-from-Fallen 8/8; generation +1).
// Read-only intelligence; nothing here submits a transaction.

export const MIN_RACES_TO_DUEL = 40;
export const MAX_DUELS = 3;
export const MAX_DUEL_RESTORES = 3;

// Rarity ladder (7 tiers incl. Common), index order from the live client bundle.
export const RARITY_TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Relic", "Giga"] as const;
export type Rarity = (typeof RARITY_TIERS)[number];

// Rarity stat floor: a minimum no stat rolls below (Uncommon none, rising to Giga). The exact
// per-tier floor values are part of the odds-model extraction; until confirmed we expose only the
// fact that a floor applies and lift the midpoint when we can prove it. Marked pending where unknown.
export const RARITY_HAS_FLOOR: Record<Rarity, boolean> = {
  Common: false, Uncommon: false, Rare: true, Epic: true, Legendary: true, Relic: true, Giga: true,
};

// Deglue glue yield + reglue cost by rarity index (from the bundle: [4,8,12,24,32,40] / [4,4,6,6,8,8]).
// Indexed Uncommon..Giga (Common is not deglued).
const GLUE_OUT = [4, 8, 12, 24, 32, 40];
const REGLUE_COST = [4, 4, 6, 6, 8, 8];
export interface GlueEconomy { deglueYield: number | null; reglueCost: number | null }
export function glueEconomy(rarity: Rarity): GlueEconomy {
  const i = RARITY_TIERS.indexOf(rarity) - 1; // Uncommon = 0
  if (i < 0 || i >= GLUE_OUT.length) return { deglueYield: null, reglueCost: null };
  return { deglueYield: GLUE_OUT[i], reglueCost: REGLUE_COST[i] };
}

// Generation: Genesis = 1; Duelborn = round(avg(parent gens)) + 1. Validated on real outcomes
// (gen-1 parents -> gen-2 Duelborn). Each generation adds a FLAT Start/Speed/Finish bonus (NOT
// Stamina), front-loaded: gen1 +0, gen2 +5, gen3 +10 ... +5/gen, easing after gen 10.
export function duelbornGeneration(genA: number, genB: number): number {
  return Math.round((genA + genB) / 2) + 1;
}

// Cumulative flat racing bonus a generation carries (Start/Speed/Finish). Front-loaded +5/gen
// through gen 10, then eased. Cumulative = sum of per-step gains below it.
export function generationBonus(gen: number): number {
  if (gen <= 1) return 0;
  let bonus = 0;
  for (let g = 2; g <= gen; g++) bonus += g <= 10 ? 5 : 2; // ease after gen 10
  return bonus;
}

export interface ParentInput {
  petId: number;
  sex: "male" | "female" | null;
  rarity: Rarity | null;
  generation: number | null;
  factionId: number | null; // 0 = Factionless; Gigus is special (see below)
  factionName: string | null;
  racesRun: number | null;
  duelsLeft: number | null; // null = unknown (assume MAX until indexed)
  stats?: { start: number; speed: number; stamina: number; finish: number } | null;
  traits?: { id: string; name: string | null; tier: number | null }[]; // for shared-trait breeding guidance
}

export type Outcome<T> = { status: "certain" | "odds" | "pending"; value?: T; note: string };

// FACTION: a 100-point pool. A natural-born parent stakes 35 toward its faction, a converted
// parent 15; unclaimed = Factionless. GIGUS is never staked; the only way to a Gigus Duelborn is
// for a Gigus parent to be the one that FALLS (then Gigus for certain); a surviving Gigus parent
// donates its stake to the other parent's faction. We do not know at preview time who will fall,
// so we present BOTH branches.
export function factionOdds(a: ParentInput, b: ParentInput): Outcome<string> {
  const aGigus = (a.factionName ?? "").toLowerCase() === "gigus";
  const bGigus = (b.factionName ?? "").toLowerCase() === "gigus";
  if (aGigus || bGigus) {
    const gigusPet = aGigus ? a : b;
    const other = aGigus ? b : a;
    return {
      status: "odds",
      note: `Gigus special: if ${gigusPet.petId} (Gigus) is the Fallen, the Duelborn is Gigus for certain. If it survives, it donates its stake and the Duelborn leans ${other.factionName ?? "the other parent's faction"}.`,
    };
  }
  // both stake 35 toward their factions (natural-born assumed); 100-pt pool, remainder Factionless.
  if (a.factionName && b.factionName && a.factionName === b.factionName) {
    return { status: "odds", value: a.factionName, note: `Both parents ${a.factionName}: Duelborn strongly leans ${a.factionName} (35+35 of 100 pts staked; remainder Factionless).` };
  }
  return {
    status: "odds",
    note: `Split pool: ${a.factionName ?? "Factionless"} ~35 vs ${b.factionName ?? "Factionless"} ~35 of 100 pts; ~30 unclaimed leans Factionless. Faction Dust can tilt it.`,
  };
}

// Expected stat = midpoint of the two parents (the bell curve is centered there), with the rarity
// floor applied. The 95% RANGE needs the odds model (spread vs parent distance), so it is pending.
export function expectedStats(a: ParentInput, b: ParentInput): Outcome<{ start: number; speed: number; stamina: number; finish: number }> {
  if (!a.stats || !b.stats) return { status: "pending", note: "Parent stats not loaded." };
  const mid = (x: number, y: number) => Math.round((x + y) / 2);
  return {
    status: "odds",
    value: {
      start: mid(a.stats.start, b.stats.start),
      speed: mid(a.stats.speed, b.stats.speed),
      stamina: mid(a.stats.stamina, b.stats.stamina),
      finish: mid(a.stats.finish, b.stats.finish),
    },
    note: "Midpoint of the parents (bell-curve center). The 95% range and the rarity floor lift come with the odds model.",
  };
}

export interface PairingValidation { ok: boolean; errors: string[]; warnings: string[] }

// Validate a pairing against the contract rules (mirrors the on-chain errors: opposite genders,
// 40+ races each, an unspent duel each). NOTE: which parent falls is CHOSEN by the breeder via Host
// Favour (aggressionBps), not forced by duels-left. Verified on the resolved set: pets with one
// duel left survived, and pets with a full three duels left were the ones sacrificed. So we do NOT
// claim a "fatal final duel" from duels-left; the only certain fall is a forced final duel, which
// is a per-listing flag not known for a hypothetical pairing.
export function validatePairing(a: ParentInput, b: ParentInput): PairingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (a.sex && b.sex && a.sex === b.sex) errors.push(`Same gender (${a.sex}): a duel pairs one male + one female.`);
  for (const p of [a, b]) {
    if (p.racesRun != null && p.racesRun < MIN_RACES_TO_DUEL) errors.push(`Gigling ${p.petId} has ${p.racesRun}/${MIN_RACES_TO_DUEL} races (NotEnoughRaces).`);
    if (p.duelsLeft != null && p.duelsLeft <= 0) errors.push(`Gigling ${p.petId} has no duels left (NoDuelsLeft).`);
  }
  if (a.petId === b.petId) errors.push("SamePet: a Gigling cannot duel itself.");
  return { ok: errors.length === 0, errors, warnings };
}

export interface BreedingPreview {
  valid: PairingValidation;
  certain: {
    generation: number | null;
    generationBonus: number | null; // flat Start/Speed/Finish add
    genderRule: string; // gender = the Fallen's, with certainty
    forcedFallen: number | null; // if exactly one pet is on its final duel, it is the certain Fallen
  };
  odds: {
    faction: Outcome<string>;
    expectedStats: Outcome<{ start: number; speed: number; stamina: number; finish: number }>;
  };
  pending: string[]; // blocked pieces, honestly named
  glue: { a: GlueEconomy; b: GlueEconomy };
}

export function breedingPreview(a: ParentInput, b: ParentInput): BreedingPreview {
  const valid = validatePairing(a, b);
  const gen = a.generation != null && b.generation != null ? duelbornGeneration(a.generation, b.generation) : null;
  // The fall is the breeder's choice via Host Favour (max fells the challenger, min fells the host),
  // so there is no pre-determined Fallen for a hypothetical pairing. forcedFallen stays null.
  const forcedFallen = null;

  return {
    valid,
    certain: {
      generation: gen,
      generationBonus: gen != null ? generationBonus(gen) : null,
      genderRule: "Gender equals the parent that falls, and you choose who falls via Host Favour: set it to sacrifice the parent whose gender you want the Duelborn to inherit.",
      forcedFallen,
    },
    odds: { faction: factionOdds(a, b), expectedStats: expectedStats(a, b) },
    pending: [
      "Rarity odds (the pairing -> outcome probability matrix)",
      "Stat 95% ranges (spread vs parent distance) and the exact rarity floor lift",
      "Trait composition (slot count, Inherit/Mutate/Fill odds, star-tier distribution)",
    ],
    glue: { a: glueEconomy(a.rarity ?? "Common"), b: glueEconomy(b.rarity ?? "Common") },
  };
}
