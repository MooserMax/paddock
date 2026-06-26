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
  recentSales: SaleCompDTO[]; // the most recent real comparable sales (rarity-matched, else collection-wide)
  recentSalesWidened: boolean; // true when recentSales are collection-wide, not rarity-matched
  recentRaces: RaceHistoryItem[];
  records: PetDistanceRecord[]; // this horse's best time per distance where it ranks
  meta: { lastSyncedAt: string | null; source: string };
}

// One real comparable sale, from the marketplace sales pool. Never fabricated.
export interface SaleCompDTO {
  tokenId: number;
  priceEth: number;
  soldAt: string;
}

// A horse's best finish at one distance, with its rank on the records board.
export interface PetDistanceRecord {
  track: number;
  bestRawMs: number | null;
  rawRank: number | null;
  bestAdjustedMs: number | null; // null when the adjustment did not validate
  adjustedRank: number | null;
  raceTemp: string;
  raceId: number;
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

// Stable Skill: shrunk average confirmed quality of a stable's proven horses.
// Measures proven roster quality, not racing skill, not value. state "ranked"
// has a percentile and rank; "limited" (1-2 proven) has a score but no rank;
// "none" (0 proven) has no score, never fabricated.
export interface StableSkill {
  state: "ranked" | "limited" | "none";
  score: number | null;
  percentile: number | null; // 0..1, rank / eligibleTotal
  rank: number | null;
  provenCount: number;
  totalHorses: number;
  avgProvenCq: number | null;
  eligibleTotal: number; // number of ranked stables, the percentile denominator
  topPetId: number | null; // highest-cq proven horse, the share-card anchor
  topPetCq: number | null; // that horse's confirmed quality
  topPetPercentile: number | null; // exact fraction of all horses with cq >= it (e.g. 0.0003 = top 0.03%)
  topPetIsBest: boolean; // true only if it is the single highest-cq horse in the game
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
  skill: StableSkill;
  aTeam: PetCardDTO[];
  hiddenGems: PetCardDTO[];
  revealQueue: RevealQueueItem[];
  trackAssignments: { distance: number; petId: number | null; name: string | null; fit: number }[];
  flags: string[];
  asOf: string | null; // last ingest completion time, for an honest "as of HH:MM"
  meta: { source: string; refreshing: boolean };
}

export interface StableRow {
  rank: number;
  ownerAddress: string;
  ownerName: string | null;
  score: number;
  percentile: number; // 0..1
  provenCount: number;
  totalHorses: number;
  avgProvenCq: number;
}

export interface StableLeaderboardResponse {
  rows: StableRow[];
  limit: number;
  offset: number;
  total: number;
  meta: { source: string; explanation: string; popMean: number; k: number; computedAt: string | null };
}

export type Recommendation = "PASS" | "ENTERABLE" | "CAUTION";

export interface VerdictBadge {
  kind: "shark" | "payout-trap" | "your-fit" | "high-elo" | "soft-field" | "poor-fit" | "off-best-fit";
  petId?: number;
  label: string;
}

export interface RaceEntrantDTO {
  petId: number;
  name: string | null;
  ownerAddress: string | null;
  finishPosition: number | null;
  timeMs: number | null; // on-chain finish time in ms, null for unresolved or lobby scans
  recordNote: string | null; // set when this horse holds a distance record, e.g. "Holds the adjusted 500m record"
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
  asOf: string | null; // last ingest completion time, for an honest "as of HH:MM"
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

export type LeaderboardMetric = "cq" | "elo" | "winrate" | "earnings" | "upside";

export interface LeaderboardRow {
  rank: number;
  petId: number;
  name: string | null;
  imgUrl: string | null;
  ownerAddress: string | null; // links to the owner's stable
  ownerName: string | null; // resolved Gigaverse username, null if none
  rarity: RarityRef;
  value: number; // the metric's primary value (for upside: reveal-adjusted upside)
  confirmedQuality: number;
  elo: number | null;
  shrunkWinRate: number;
  rawWinRate: number | null;
  racesRun: number;
  earningsEth: number | null;
  revealPct: number | null; // 0..1, populated for the upside board
  upsideRaw: number | null; // raw upside, populated for the upside board
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

// ---- Race Finder, live forming lobbies + your edge ----------------------------
export interface LobbyEntrant {
  petId: number;
  name: string | null;
  ownerName: string | null;
  ownerAddress: string | null;
  rarity: number;
  elo: number | null;
  confirmedQuality: number;
  isShark: boolean;
  juiced: boolean;
  known: boolean; // false if we have no strength data for this horse yet
}

// One selectable horse for a lobby, with its win band. Same band/EV data as the
// single pick, just per horse, so the user can choose a runner-up knowingly.
export interface LobbyEdgeOption {
  petId: number;
  petName: string | null;
  pWin: number; // raw model win probability; uncalibrated, do not render as a precise percent
  band: string;
  bandRange: string;
  evWei: string | null; // capped-EV estimate in wei, null for free races
}

export interface LobbyEdge {
  petId: number;
  petName: string | null;
  pWin: number; // raw model win probability, used for ranking; uncalibrated, do not render as a precise percent
  band: string; // honest banded label for display, e.g. "Heavy favorite" (see pWinBand)
  bandRange: string; // coarse range text for the band, e.g. "best in this field"
  calibrated: boolean; // always false here: the live model's ELO/fit signals are not validated at these odds
  evWei: string | null; // estimated value in wei from the capped pWin, null for free races; an estimate, not a precise figure
  eligibleCount: number; // how many of your horses could enter this lobby
  // The user's top eligible horses for this lobby, best first (cap 5). options[0]
  // equals the single-pick fields above, so anything reading edge.petId is unchanged.
  options: LobbyEdgeOption[];
}

export interface LobbyRow {
  raceId: number;
  trackLength: number;
  raceTemp: string | null; // null while forming, conditions are set at start
  fieldSize: number;
  petCount: number;
  openSlots: number;
  entryFeeWei: string;
  poolWei: string | null;
  payoutBps: number[];
  // Live protocol surcharge rates from race config, used to compute the exact paid
  // entry value per juiced tier. Null until fee config has loaded for the race.
  protocolFeeBps: number | null;
  protocolFeeBpsJuiced: number | null;
  entrants: LobbyEntrant[];
  fieldStrength: { avgElo: number | null; sharkCount: number; topCq: number };
  edge: LobbyEdge | null; // present when a wallet/pet is given and a horse is eligible
}

// ---- Develop Mode: bulk reveal-farming into free races ----------------------
export interface DevelopCandidate {
  petId: number;
  name: string | null;
  rarity: number;
  revealPct: number; // 0..1 overall reveal progress (less is more to gain)
  reveals: { start: number; speed: number; stamina: number; finish: number }; // per-stat reveal counts
  racesRun: number;
  // "not_registered": hatched but not registered for racing on-chain (cannot race).
  status: "available" | "racing" | "resting" | "not_registered";
}

export interface DevelopRace {
  raceId: number;
  trackLength: number;
  fieldSize: number;
  petCount: number;
  openSlots: number;
  raceTemp: string | null;
}

export interface DevelopResponse {
  wallet: string | null;
  // The wallet's hatched horses ranked by DEVELOPMENT NEED (least revealed first),
  // the opposite of Race Finder's win-edge ranking.
  candidates: DevelopCandidate[];
  freeRaces: DevelopRace[]; // open, forming, entry fee 0, with at least one slot
  openFreeSlots: number; // total free slots available right now
  asOf: string | null;
  fetchedAt: string | null;
  delayed: boolean;
  meta: { source: string; note: string };
}

// Validation for a manually typed horse ID, gating a manual override the same way a
// picked horse is gated: ownership + eligibility + (for a given race) its band.
export interface PetEntryCheck {
  petId: number;
  petName: string | null;
  owned: boolean; // the connected wallet owns this Gigling
  status: "available" | "racing" | "resting" | "unknown";
  alreadyEntered: boolean; // already an entrant in the given race
  eligible: boolean; // owned && available && race open && not already entered
  reason: string | null; // why it cannot be entered, if so
  pWin: number | null; // the horse's win probability in the given race's field
  band: string | null;
  bandRange: string | null;
  evWei: string | null;
}

export interface LobbyResponse {
  lobbies: LobbyRow[];
  wallet: string | null;
  pet: number | null;
  personalized: boolean;
  rankedBy: "edge" | "open"; // edge (your pWin) when personalized, else by openSlots/recency
  fetchedAt: string | null; // live chain snapshot time (forming-lobby field freshness)
  asOf: string | null; // last ingest completion time (resolved-state freshness), for "as of HH:MM"
  delayed: boolean; // live upstream is throttled, snapshot may be stale
  pollMs: number; // suggested client poll interval
  // Daily race eligibility of the user's roster, two stable states like dagrid.
  // resting horses have used their daily race limit; racing horses are busy in a
  // race now. Neither is recommended; allUnavailable is honest about there being no
  // enterable play. eligibleCount is the recommendable count.
  roster: {
    eligibleCount: number;
    allUnavailable: boolean;
    resting: { petId: number; name: string | null }[];
    racing: { petId: number; name: string | null }[];
  } | null;
  meta: { source: string; note: string };
}

export type RecordMode = "raw" | "adjusted";
export type RecordWindow = "all" | "weekly" | "daily";

export interface RecordRow {
  rank: number;
  petId: number;
  name: string | null;
  rarity: number;
  ownerName: string | null;
  ownerAddress: string | null;
  rawTimeMs: number;
  adjustedTimeMs: number | null; // null when the condition adjustment did not validate
  raceTemp: string;
  raceId: number;
  resolvedAt: string | null;
}

// The single fastest finish in the game, the records-page hero.
export interface RecordHero {
  petId: number;
  name: string | null;
  rarity: number;
  ownerName: string | null;
  ownerAddress: string | null;
  track: number;
  timeMs: number;
  adjusted: boolean; // true if this track's adjustment is applied
  raceTemp: string;
  raceId: number;
}

export interface RecordsResponse {
  track: number;
  mode: RecordMode;
  window: RecordWindow;
  adjustedAvailable: boolean; // some track has a board-fair adjustment, so the toggle is offered
  adjustmentApplied: boolean; // the SELECTED track's adjustment passed the board gate
  referenceCondition: string;
  tracks: number[]; // tracks with enough records to show
  adjustedTracks: number[]; // subset of tracks where the adjustment is applied
  fastest: RecordHero | null; // the single fastest finish across all tracks
  limit: number;
  offset: number;
  total: number;
  rows: RecordRow[];
  meta: { source: string; explanation: string; computedAt: string | null };
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
  racesScannedAt: string | null; // when discovery last ran (NOT resolution recency)
  lastResolvedAt: string | null; // finish time of the newest resolved race we hold
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

// Piece 3: follow-your-entry race tracking (read-only).
export interface MyRaceDTO {
  raceId: number | null; // most recent race the wallet's pets are in, null if none found
  petId: number | null; // the wallet's pet in that race
}

export interface RaceTrackEntrant {
  petId: number;
  name: string | null;
  finishPosition: number | null; // present once resolved
  timeMs: number | null;
  isYours: boolean;
}

export interface RaceTrackingDTO {
  raceId: number;
  phase: number; // 1 forming, 2 locked/running, 3 resolved
  resolved: boolean;
  trackLength: number;
  raceTemp: string | null;
  fieldSize: number;
  petCount: number;
  entrants: RaceTrackEntrant[];
  yourPetId: number;
  yourName: string | null;
  yourPlacing: number | null; // finish position once resolved
  yourTimeMs: number | null;
  yourPayoutWei: string | null;
  band: { label: string; range: string } | null; // Paddock's prediction for your horse
  fetchedAt: string;
}

// Homepage recent paid-race wins feed (read-only, real winner takes only).
export interface RecentWin {
  raceId: number;
  petId: number;
  petName: string | null;
  ownerAddress: string | null;
  ownerName: string | null;
  payoutWei: string; // the winner's actual received take, petPayouts[winner].amount
  payoutEth: number;
  payoutUsd: number | null; // null when no eth price is cached
  trackLength: number | null;
  fieldSize: number | null;
  resolvedAt: string | null;
}

export interface RecentWinsResponse {
  wins: RecentWin[];
  ethUsd: number | null;
  fetchedAt: string;
}
