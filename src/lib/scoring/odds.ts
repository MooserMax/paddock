import { shrunkWinRate } from "./engine";
import { MODEL_VERSION } from "../api/types";

// odds-v1: a transparent, self-grading win-probability model. Each entrant gets
// a strength from three signals the engine already trusts: Bayesian-shrunk win
// rate (proven results), ELO (relative finishing record), and track fit (the
// study's trait-by-distance lifts plus revealed stats). Strengths go through a
// softmax over the actual field, so probabilities always sum to 1.
//
// This is a probability product, not a betting product. It is backtested
// against resolved races and publishes its own calibration curve.
//
// LOCKED REQUIREMENT for the Surface 5 backtest (do not relax): calibration must
// be OUT OF SAMPLE. Any weight fitting/tuning happens on races before a temporal
// cutoff; the published calibration curve is computed ONLY on held-out races after
// it. Walk-forward is preferred (races are time-ordered). The /calibration page
// must state the split explicitly. In-sample calibration is a fabricated number
// wearing a chart and does not ship.

export interface OddsEntrantInput {
  petId: number;
  wins: number;
  racesRun: number;
  elo: number | null;
  trackFit: number; // 0..100 fit at this race's distance
}

const W_WINRATE = 1.9;
const W_ELO = 1.4;
const W_FIT = 0.9;
const TEMPERATURE = 1.0;

export function entrantStrength(e: OddsEntrantInput): number {
  const winSignal = (shrunkWinRate(e.wins, e.racesRun) - 0.1418) / 0.12;
  const eloSignal = e.elo !== null ? (e.elo - 1500) / 180 : 0;
  const fitSignal = (e.trackFit - 50) / 50;
  return W_WINRATE * winSignal + W_ELO * eloSignal + W_FIT * fitSignal;
}

export interface OddsResult {
  petId: number;
  strength: number;
  winProbability: number;
}

export function computeOdds(entrants: OddsEntrantInput[]): {
  modelVersion: string;
  results: OddsResult[];
} {
  const strengths = entrants.map((e) => ({ petId: e.petId, strength: entrantStrength(e) }));
  // Softmax with a numerically-stable shift.
  const max = Math.max(...strengths.map((s) => s.strength), 0);
  const exps = strengths.map((s) => ({ petId: s.petId, strength: s.strength, e: Math.exp((s.strength - max) / TEMPERATURE) }));
  const sum = exps.reduce((a, b) => a + b.e, 0) || 1;
  return {
    modelVersion: MODEL_VERSION,
    results: exps.map((x) => ({
      petId: x.petId,
      strength: x.strength,
      winProbability: x.e / sum,
    })),
  };
}
