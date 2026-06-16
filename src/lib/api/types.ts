// The Paddock API contract. These types are the single source of truth shared
// between /api/v1 route handlers and the site that consumes them. The site
// imports these exact types; "every number on this site comes from this
// endpoint" is enforced by the type system, not just by convention.
//
// Honest-data contract, encoded in the shape itself: an unrevealed stat is a
// range with revealed=false, never a midpoint number. Thin valuation comps
// carry a thin flag. Win rates ship both shrunk and raw.

export const MODEL_VERSION = "odds-v1";
export const API_VERSION = "v1";

export interface ApiError {
  error: { code: string; message: string };
}

export interface RarityRef {
  value: number;
  name: string;
}

export interface FactionRef {
  value: number;
  name: string;
}

// A single stat. low/high are the revealed range bounds. We never expose a
// midpoint as a value: callers render the range and the reveal fraction.
export interface StatRangeDTO {
  low: number | null;
  high: number | null;
  reveals: number | null;
  revealPct: number; // 0..1, how narrow (revealed) the range is
  revealed: boolean; // true only when essentially pinned down
}

export interface TraitDTO {
  id: string;
  name: string;
  tier: number | null; // null = star level not yet revealed
  blurb: string;
  globalLift: number | null; // study-measured win-rate multiplier, if significant
}

export interface SharkProfile {
  shrunkWinRate: number; // Bayesian-shrunk toward the population baseline
  rawWinRate: number | null;
  wins: number;
  racesRun: number;
  elo: number | null;
}

export interface ValuationBandDTO {
  lowEth: number | null;
  highEth: number | null;
  compCount: number;
  thin: boolean;
  // Below 5 comps the IQR band is shown but flagged low-confidence (thin is < 3).
  lowConfidence: boolean;
  note: string;
}

export interface TrackFitDTO {
  "500": number;
  "1200": number;
  "2400": number;
  "3000": number;
}

export interface PetDossier {
  id: number;
  name: string | null;
  ownerAddress: string | null;
  ownerName: string | null; // resolved Gigaverse username of the owner, null if none
  imgUrl: string | null;
  hatched: boolean;
  rarity: RarityRef;
  faction: FactionRef;
  revealPct: number; // overall reveal progress, 0..1
  stats: { start: StatRangeDTO; speed: StatRangeDTO; stamina: StatRangeDTO; finish: StatRangeDTO };
  traits: TraitDTO[];
  scores: {
    confirmedQuality: number;
    upside: number;
    bestDistance: number;
    fit: TrackFitDTO;
    nextMilestoneIn: number | null;
    traitsRevealed: number;
    traitsTotal: number;
  };
  shark: SharkProfile;
  valuation: ValuationBandDTO;
  recentRaces: RaceHistoryItem[];
  meta: { lastSyncedAt: string | null; source: string };
}

export interface RaceHistoryItem {
  raceId: number;
  finishPosition: number | null;
  fieldSize: number | null;
  trackLength: number | null;
  resolvedAt: string | null;
  payoutWei: string | null;
}

export interface PetCardDTO {
  id: number;
  name: string | null;
  imgUrl: string | null;
  rarity: RarityRef;
  confirmedQuality: number;
  upside: number;
  bestDistance: number;
  revealPct: number;
  elo: number | null;
}

export interface RevealQueueItem {
  id: number;
  name: string | null;
  nextMilestoneIn: number | null;
  upside: number;
  revealPct: number;
}

export interface WalletSummary {
  address: string;
  name: string | null;
  petCount: number;
  hatchedCount: number;
  stableValue: {
    lowEth: number | null;
    highEth: number | null;
    estimated: true;
    compCountTotal: number;
  };
  aTeam: PetCardDTO[];
  hiddenGems: PetCardDTO[];
  revealQueue: RevealQueueItem[];
  trackAssignments: { distance: number; petId: number | null; name: string | null; fit: number }[];
  flags: string[];
  meta: { source: string; refreshing: boolean };
}

export type Recommendation = "PASS" | "ENTERABLE" | "CAUTION";

export interface VerdictBadge {
  kind: "shark" | "payout-trap" | "your-fit" | "high-elo" | "soft-field";
  petId?: number;
  label: string;
}

export interface RaceEntrantDTO {
  petId: number;
  name: string | null;
  ownerAddress: string | null;
  finishPosition: number | null;
  shrunkWinRate: number;
  rawWinRate: number | null;
  wins: number;
  racesRun: number;
  elo: number | null;
  revealedTraits: { id: string; name: string; tier: number }[];
  revealPct: number;
  bestDistance: number;
  isShark: boolean;
  highElo: boolean;
}

export interface VerdictDTO {
  recommendation: Recommendation;
  headline: string;
  badges: VerdictBadge[];
  sharkPetIds: number[];
  payoutTrap: boolean;
  caveat: string;
}

export interface RaceDetail {
  raceId: number;
  trackLength: number | null;
  raceTemp: string | null;
  fieldSize: number | null;
  entryFeeWei: string | null;
  payoutBps: number[] | null;
  feeBps: Record<string, number> | null;
  resolved: boolean;
  resolvedAt: string | null;
  entrants: RaceEntrantDTO[];
  verdict: VerdictDTO;
  meta: { source: string; eloThreshold: number };
}

export interface OddsEntrant {
  petId: number;
  name: string | null;
  winProbability: number; // 0..1, model output
  strength: number; // raw pre-normalization strength, for transparency
}

export interface OddsResponse {
  raceId: number;
  modelVersion: string;
  entrants: OddsEntrant[];
  note: string;
  meta: { source: string };
}

export type LeaderboardMetric = "cq" | "elo" | "winrate" | "earnings";

export interface LeaderboardRow {
  rank: number;
  petId: number;
  name: string | null;
  imgUrl: string | null;
  ownerAddress: string | null; // links to the owner's stable
  ownerName: string | null; // resolved Gigaverse username, null if none
  rarity: RarityRef;
  value: number; // the metric's primary value
  confirmedQuality: number;
  elo: number | null;
  shrunkWinRate: number;
  rawWinRate: number | null;
  racesRun: number;
  earningsEth: number | null;
}

export interface CalibrationBucket {
  lo: number;
  hi: number;
  predictedMean: number;
  actualFreq: number;
  count: number;
}

export interface CalibrationResult {
  modelVersion: string;
  scope: string;
  split: { method: string; cutoffRaceId: number; trainRaces: number; testRaces: number; fittedBeta: number };
  metrics: {
    heldOutEntries: number;
    brier: number;
    baselineBrier: number;
    logLoss: number;
    fieldBaselineWinRate: number;
  };
  buckets: CalibrationBucket[];
  generatedAt: string | null;
  meta: { source: string };
}

export interface RaceListItem {
  raceId: number;
  trackLength: number | null;
  fieldSize: number | null;
  raceTemp: string | null;
  resolvedAt: string | null;
  payoutBps: number[] | null;
  winnerPetId: number | null;
  winnerName: string | null;
}

export interface RaceListResponse {
  races: RaceListItem[];
  limit: number;
  offset: number;
  track: number | null;
  meta: { source: string };
}

export interface SiteStats {
  racesResolved: number;
  racesCreated: number;
  // Created but never run: too few entrants, expired. Distinct from pending.
  racesAbandoned: number;
  totalPets: number;
  hatchedPets: number;
  recentBigSale: { tokenId: number; priceEth: number; soldAt: string } | null;
  topConfirmed: { petId: number; name: string | null; confirmedQuality: number } | null;
  ethUsd: number | null;
  petsSyncedAt: string | null;
  racesScannedAt: string | null;
  meta: { source: string };
}

export interface LeaderboardResponse {
  metric: LeaderboardMetric;
  limit: number;
  offset: number;
  total: number;
  rows: LeaderboardRow[];
  meta: { source: string; explanation: string };
}
