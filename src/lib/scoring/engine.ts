import {
  BASE_WIN_RATE,
  CONFIRMED_WEIGHTS,
  FRESH_RANGE_WIDTH,
  GLOBAL_TRAIT_LIFT,
  MAX_TRAIT_EDGE,
  MILESTONE_INTERVAL,
  RARITY_UPSIDE,
  STAT_CEIL,
  STAT_FLOOR,
  TRACK_LENGTHS,
  TRACK_STAT_WEIGHTS,
  TRACK_TRAIT_LIFT,
  TrackLength,
  UPSIDE_WEIGHTS,
  WIN_NORM_CEIL,
  WIN_NORM_FLOOR,
  WIN_PRIOR_STRENGTH,
} from "./constants";

export type StatKey = "start" | "speed" | "stamina" | "finish";
export const STAT_KEYS: StatKey[] = ["start", "speed", "stamina", "finish"];

export interface StatRange {
  min: number | null;
  max: number | null;
  reveals: number | null;
}

export interface TraitInput {
  id: string;
  tier: number | null; // null = star level not yet revealed
}

export interface PetInput {
  rarity: number | null;
  racesRun: number | null;
  maxRaces: number | null;
  wins: number | null;
  stats: Record<StatKey, StatRange>;
  traits: TraitInput[];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Normalize a stat value from its practical [50, 100] band into [0, 1].
export function normStat(value: number): number {
  return clamp01((value - STAT_FLOOR) / (STAT_CEIL - STAT_FLOOR));
}

// Per-stat reveal fraction from how far the min-max range has narrowed from a
// fresh width of ~50. Honest by construction: a wide range reads as unrevealed.
export function statReveal(range: StatRange): number {
  if (range.min === null || range.max === null) return 0;
  const width = Math.max(0, range.max - range.min);
  return clamp01((FRESH_RANGE_WIDTH - width) / FRESH_RANGE_WIDTH);
}

function statMid(range: StatRange): number | null {
  if (range.min === null || range.max === null) return null;
  return (range.min + range.max) / 2;
}

// Lift for a trait at a given track: track-specific measurement if available,
// else the global measurement, else neutral (1.0).
export function traitLiftAt(traitId: string, track: TrackLength): number {
  return TRACK_TRAIT_LIFT[track]?.[traitId] ?? GLOBAL_TRAIT_LIFT[traitId] ?? 1.0;
}

// Convert a lift multiplier into a signed edge in roughly [-1, 1], scaled by
// the strongest measured lift. Surger reads strongly positive; Volatile negative.
function liftEdge(lift: number): number {
  return (lift - 1) / MAX_TRAIT_EDGE;
}

// Bayesian-shrunk win rate: pull the observed rate toward the population
// baseline using a beta prior of WIN_PRIOR_STRENGTH race-equivalents.
export function shrunkWinRate(wins: number, races: number): number {
  return (
    (wins + BASE_WIN_RATE * WIN_PRIOR_STRENGTH) / (races + WIN_PRIOR_STRENGTH)
  );
}

function normWin(rate: number): number {
  return clamp01((rate - WIN_NORM_FLOOR) / (WIN_NORM_CEIL - WIN_NORM_FLOOR));
}

export interface RevealProgress {
  overall: number; // 0-1, blended stat + trait reveal
  stats: number; // 0-1, mean stat reveal
  traitsRevealed: number;
  traitsTotal: number;
}

export function revealProgress(pet: PetInput): RevealProgress {
  const statFracs = STAT_KEYS.map((k) => statReveal(pet.stats[k]));
  const stats = statFracs.reduce((a, b) => a + b, 0) / STAT_KEYS.length;
  const traitsTotal = pet.traits.length;
  const traitsRevealed = pet.traits.filter((t) => t.tier !== null).length;
  const traitFrac = traitsTotal > 0 ? traitsRevealed / traitsTotal : 0;
  // Stats carry more information than star levels, so weight them higher.
  const overall = clamp01(0.65 * stats + 0.35 * traitFrac);
  return { overall, stats, traitsRevealed, traitsTotal };
}

// Confirmed quality (0-100): how good is this horse, proven. Uses ONLY
// revealed information. Unrevealed stats and unrevealed trait tiers contribute
// nothing, so a fresh horse scores near the win-rate prior and no higher.
export function confirmedQuality(pet: PetInput): number {
  // Stat component: revealed stat quality, weighted by how revealed each is.
  let statAccum = 0;
  for (const k of STAT_KEYS) {
    const range = pet.stats[k];
    const mid = statMid(range);
    if (mid === null) continue;
    statAccum += statReveal(range) * normStat(mid);
  }
  const statComponent = statAccum / STAT_KEYS.length; // 0-1

  // Win component: outcome evidence, shrunk toward the baseline.
  const races = pet.racesRun ?? 0;
  const wins = pet.wins ?? 0;
  const winComponent = normWin(shrunkWinRate(wins, races));

  // Trait component: only revealed star levels count, weighted by tier and lift.
  let traitAccum = 0;
  for (const t of pet.traits) {
    if (t.tier === null) continue;
    const edge = liftEdge(GLOBAL_TRAIT_LIFT[t.id] ?? 1.0);
    traitAccum += edge * (t.tier / 3);
  }
  const traitComponent = clamp01(traitAccum); // 0-1, Volatile can offset Surger

  const w = CONFIRMED_WEIGHTS;
  const raw =
    w.stat * statComponent + w.win * winComponent + w.trait * traitComponent;
  return 100 * (raw / (w.stat + w.win + w.trait));
}

// Upside (0-100): lottery-ticket quality for unrevealed horses. Rarity as a
// stat-ceiling proxy, traits carried (presence is visible from birth) weighted
// by lift, and races remaining to reveal and prove that potential. Clearly
// potential, not proof.
export function upsideScore(pet: PetInput): number {
  const rarityComponent = RARITY_UPSIDE[pet.rarity ?? 0] ?? 0.1;

  let traitAccum = 0;
  for (const t of pet.traits) {
    traitAccum += Math.max(0, liftEdge(GLOBAL_TRAIT_LIFT[t.id] ?? 1.0));
    if ((GLOBAL_TRAIT_LIFT[t.id] ?? 1.0) < 1) {
      traitAccum += liftEdge(GLOBAL_TRAIT_LIFT[t.id]); // Volatile drags upside down
    }
  }
  const traitComponent = clamp01(traitAccum);

  const races = pet.racesRun ?? 0;
  const maxRaces = pet.maxRaces ?? 60;
  const racesLeftComponent = clamp01(maxRaces > 0 ? (maxRaces - races) / maxRaces : 0);

  const w = UPSIDE_WEIGHTS;
  const raw =
    w.rarity * rarityComponent +
    w.traits * traitComponent +
    w.racesLeft * racesLeftComponent;
  // Upside fades as a horse reveals: the more we know, the less is "potential".
  const unrevealed = 1 - 0.5 * revealProgress(pet).overall;
  return 100 * (raw / (w.rarity + w.traits + w.racesLeft)) * unrevealed;
}

export type TrackFit = Record<TrackLength, number>;

// Track fit per distance (0-100): revealed stat profile against the track's
// stat emphasis, plus trait lifts at that track. Revealed trait tiers count
// for more than mere presence. Output also yields the best distance.
export function trackFit(pet: PetInput): { fit: TrackFit; best: TrackLength } {
  const fit = {} as TrackFit;
  for (const track of TRACK_LENGTHS) {
    const weights = TRACK_STAT_WEIGHTS[track];
    let statPart = 0;
    let revealWeight = 0;
    for (const k of STAT_KEYS) {
      const range = pet.stats[k];
      const mid = statMid(range);
      if (mid === null) continue;
      const r = statReveal(range);
      statPart += weights[k] * normStat(mid) * r;
      revealWeight += weights[k] * r;
    }
    // Normalize by revealed weight so partially-revealed horses are comparable.
    const statScore = revealWeight > 0 ? statPart / revealWeight : 0.5;

    let traitPart = 0;
    for (const t of pet.traits) {
      const edge = liftEdge(traitLiftAt(t.id, track));
      // Carrying a trait is known from birth, so presence always counts. A
      // revealed star level scales the magnitude up and must never count for
      // less than an unknown tier: tier 1 -> 0.6, tier 3 -> 1.0, unknown -> 0.55.
      const weight =
        t.tier !== null ? 0.6 + 0.4 * ((t.tier - 1) / 2) : 0.55;
      traitPart += edge * weight;
    }

    const score = 0.55 * statScore + 0.45 * clamp01(0.5 + traitPart);
    fit[track] = 100 * clamp01(score);
  }
  let best: TrackLength = TRACK_LENGTHS[0];
  for (const track of TRACK_LENGTHS) if (fit[track] > fit[best]) best = track;
  return { fit, best };
}

// Races until the next 5th-race trait-reveal milestone. Null when the horse has
// no races remaining or every trait is already revealed.
export function nextMilestoneIn(pet: PetInput): number | null {
  const races = pet.racesRun ?? 0;
  const maxRaces = pet.maxRaces ?? 60;
  if (races >= maxRaces) return null;
  if (pet.traits.length > 0 && pet.traits.every((t) => t.tier !== null)) return null;
  const rem = races % MILESTONE_INTERVAL;
  const toNext = rem === 0 ? MILESTONE_INTERVAL : MILESTONE_INTERVAL - rem;
  return races + toNext > maxRaces ? null : toNext;
}

export interface PetScore {
  revealProgress: number;
  traitsRevealed: number;
  traitsTotal: number;
  confirmedQuality: number;
  upside: number;
  fit: TrackFit;
  bestDistance: TrackLength;
  nextMilestoneIn: number | null;
}

export function scorePet(pet: PetInput): PetScore {
  const reveal = revealProgress(pet);
  const { fit, best } = trackFit(pet);
  return {
    revealProgress: reveal.overall,
    traitsRevealed: reveal.traitsRevealed,
    traitsTotal: reveal.traitsTotal,
    confirmedQuality: confirmedQuality(pet),
    upside: upsideScore(pet),
    fit,
    bestDistance: best,
    nextMilestoneIn: nextMilestoneIn(pet),
  };
}
