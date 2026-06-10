// Paddock scoring constants. Every number here is grounded in the Patch Notes
// full-population study of 4,537 resolved races / 30,288 entries, or in the
// game's published mechanics. The UI cites these so users can audit the math.

// Global win-rate baseline measured across the population. Used as the
// Bayesian prior for win-rate shrinkage.
export const BASE_WIN_RATE = 0.1418;

// Prior strength for win-rate shrinkage, in race-equivalents. A horse needs
// this many races before its observed win rate is trusted over the baseline.
// Tuned so 2-for-3 (0.20 shrunk) does not outrank 20-for-60 (0.28 shrunk).
export const WIN_PRIOR_STRENGTH = 25;

// Global trait lift (win-rate multiplier vs the 14.18% baseline) when the
// trait is active, measured across all tracks. 1.0 is neutral; below 1.0 the
// trait hurts. Traits not listed were not significant in the study.
export const GLOBAL_TRAIT_LIFT: Record<string, number> = {
  surger: 1.63, // the alpha trait: 23.19% win when active, z=12.45, n=2,674
  volatile: 0.81, // actively hurts, z=-3.74
};

// Track-segmented trait lift. Only statistically meaningful values from the
// study are encoded. Closer's edge appears only at 2400m and longer, so it is
// carried forward to 3000m at its measured 2400m value (flagged as held, not
// separately measured, in the methodology page).
export const TRACK_TRAIT_LIFT: Record<number, Record<string, number>> = {
  500: { surger: 1.57, "faction-heart": 1.25, clutch: 1.23 },
  1200: { surger: 1.69 },
  2400: { surger: 1.72, closer: 1.47 },
  3000: { surger: 1.85, "fast-start": 1.84, closer: 1.47, clutch: 0.43, "faction-heart": 0.64 },
};

export const TRACK_LENGTHS = [500, 1200, 2400, 3000] as const;
export type TrackLength = (typeof TRACK_LENGTHS)[number];

// Per-track emphasis on each of the four stats, reflecting race distance.
// Sprints reward Start and Speed; routes reward Stamina and Finish. Each row
// sums to 1 so track-fit stat components are comparable across distances.
export const TRACK_STAT_WEIGHTS: Record<number, {
  start: number; speed: number; stamina: number; finish: number;
}> = {
  500: { start: 0.35, speed: 0.35, stamina: 0.1, finish: 0.2 },
  1200: { start: 0.2, speed: 0.3, stamina: 0.3, finish: 0.2 },
  2400: { start: 0.1, speed: 0.2, stamina: 0.35, finish: 0.35 },
  3000: { start: 0.15, speed: 0.15, stamina: 0.4, finish: 0.3 },
};

// Stat values in practice live in [50, 100] (a fresh horse shows ~50-100 on
// everything). Normalization maps that band to [0, 1].
export const STAT_FLOOR = 50;
export const STAT_CEIL = 100;

// A fresh, fully unrevealed stat shows a range width of ~50 (50 to 100). The
// width shrinks toward 0 as the stat is revealed, so reveal fraction is
// (FRESH_WIDTH - width) / FRESH_WIDTH.
export const FRESH_RANGE_WIDTH = 50;

// Rarity as a stat-ceiling proxy for the upside score. Higher rarity implies a
// higher potential stat ceiling. Relic (5) outranks Legendary (4): never get
// this backwards.
export const RARITY_UPSIDE: Record<number, number> = {
  6: 1.0, // Giga
  5: 0.8, // Relic
  4: 0.62, // Legendary
  3: 0.42, // Epic
  2: 0.25, // Rare
  0: 0.1, // Unknown / unhatched
};

export const RARITY_NAME: Record<number, string> = {
  6: "Giga",
  5: "Relic",
  4: "Legendary",
  3: "Epic",
  2: "Rare",
  0: "Unknown",
};

// Trait star levels reveal at every 5th race (milestone races).
export const MILESTONE_INTERVAL = 5;

// Confirmed-quality component weights. Stats are the strongest single signal in
// the game (winners average +3.8% on all four, z>24 each), so they lead;
// finishing results (win rate) are direct outcome evidence; revealed trait
// tiers refine. Components from unrevealed information contribute zero, by
// design: confirmed quality never credits what cannot yet be seen.
export const CONFIRMED_WEIGHTS = { stat: 0.45, win: 0.35, trait: 0.2 };

// Upside component weights for unrevealed horses (lottery-ticket quality):
// rarity ceiling, traits carried (presence is visible from birth), and races
// remaining to reveal and prove that potential.
export const UPSIDE_WEIGHTS = { rarity: 0.4, traits: 0.4, racesLeft: 0.2 };

// Normalize a shrunk win rate into [0, 1] for scoring. Baseline (~0.14) maps
// near the floor; an elite sustained ~0.40 maps to the top.
export const WIN_NORM_FLOOR = 0.1;
export const WIN_NORM_CEIL = 0.4;

// The strongest measured trait lift (Surger at 3000m, 1.85) sets the scale for
// converting a lift into a [0, 1] trait-value contribution.
export const MAX_TRAIT_EDGE = 0.85;

// Minimum comparable sales required before Paddock will quote a valuation band.
// Below this we say comps are thin rather than invent a number.
export const MIN_VALUATION_COMPS = 3;
