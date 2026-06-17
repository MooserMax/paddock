import { shrunkWinRate } from "./engine";
import { TRACK_LENGTHS } from "./constants";
import type { RaceEntrantDTO, VerdictDTO, VerdictBadge } from "../api/types";

// Distance-fit thresholds, set from the Phase 1 out-of-sample study
// (scripts/study-distance-fit.mts). Fit is validated as directional but modest:
// the within-horse, quality-controlled (leave-one-out demeaned) finish penalty,
// bucketed by fit-points below the horse's own best, runs:
//   < 3 pts:  negative (no harm)            -> no badge (co-best / noise)
//   3 to 15:  ~0 to +0.004 (modest)         -> off-best, soft note
//   >= 15:    +0.009 plateau (material)     -> weak, caution
// The absolute point gap is the cleaner predictor; the spread ratio is the guard
// so a high-spread horse is not flagged for a proportionally minor gap.
export const FIT_COBEST_GAP_PTS = 3.0; // below this, penalty is negative: no badge
export const FIT_WEAK_GAP_PTS = 15.0; // material penalty begins here (+0.009 at [15,20))
export const FIT_WEAK_RATIO = 0.5; // gap must be >= half the horse's own fit spread

// The scanner's verdict logic. It does not show data, it gives a call. Field
// quality is read from history; what it cannot know (real-time reveal state and
// daily exhaustion) is stated plainly in the caveat, never papered over.

// A shark is a proven, fearsome winner, flagged on SHRUNK win rate.
//
// History: the field autopsy proposed 0.60, but that was a RAW win rate. The
// engine flags on the Bayesian-SHRUNK rate (different scale), where the highest
// value in the game is ~49% and 0.60 is statistically unreachable, so the number
// had to move; this is a conscious change, not an inherited one.
//
// Calibration: 0.30 marks the top ~1.6% of the field (65 of 4,061 racers, p98-p99).
// Ratified OUT OF SAMPLE (scripts/validate-shark.mjs): walking races in order and
// flagging on each horse's PRIOR record only, horses flagged at 0.30 went on to win
// 50.9% of their next races vs a 14.9% field baseline (3.41x lift). The flag is
// predictive, not cosmetic; the lift curve is smooth (0.28 -> 48.6%, 0.33 -> 53.5%),
// so the threshold is robust anywhere in 0.28-0.33 and 0.30 is the clean choice.
export const SHARK_WIN_RATE = 0.3;

export interface VerdictContext {
  payoutBps: number[] | null;
  eloThreshold: number; // 90th percentile of the live ELO ladder, computed upstream
  markedPetId?: number; // "your horse" for the YOUR FIT call
  trackLength: number | null;
  markedFit?: Record<number, number>; // marked horse's fit map (keys 500/1200/2400/3000)
}

// A race pays "top-2 only" when at most two finishing positions are rewarded.
function isTopTwoPayout(payoutBps: number[] | null): boolean {
  if (!payoutBps) return false;
  const paid = payoutBps.filter((b) => b > 0);
  return paid.length > 0 && paid.length <= 2;
}

export function computeVerdict(
  entrants: RaceEntrantDTO[],
  ctx: VerdictContext
): VerdictDTO {
  const badges: VerdictBadge[] = [];
  const sharkPetIds: number[] = [];

  for (const e of entrants) {
    if (e.isShark) {
      sharkPetIds.push(e.petId);
      badges.push({ kind: "shark", petId: e.petId, label: `Shark ${Math.round(e.shrunkWinRate * 100)}%` });
    } else if (e.highElo) {
      badges.push({ kind: "high-elo", petId: e.petId, label: `High ELO ${e.elo ?? ""}` });
    }
  }

  const topTwo = isTopTwoPayout(ctx.payoutBps);
  const payoutTrap = topTwo && sharkPetIds.length > 0;
  if (payoutTrap) {
    badges.unshift({ kind: "payout-trap", label: "Payout trap, top 2 only" });
  }

  // Distance-fit assessment for the marked horse. "Off its own best" and "weak
  // at this distance" are different claims, so they are separate states using
  // BOTH the absolute fit-point gap (the cleaner Phase 1 predictor) and the
  // spread-normalized ratio (the guard). Co-best / within noise stays silent so a
  // weak-magnitude signal never throws a false alarm.
  type FitState = "fits" | "off-best" | "weak" | null;
  let fitState: FitState = null;
  const marked = ctx.markedPetId != null ? entrants.find((e) => e.petId === ctx.markedPetId) : undefined;
  if (marked && ctx.markedFit && ctx.trackLength != null) {
    const fitAtTrack = ctx.markedFit[ctx.trackLength];
    const vals = TRACK_LENGTHS.map((t) => ctx.markedFit![t]).filter((v): v is number => typeof v === "number");
    if (typeof fitAtTrack === "number" && vals.length > 0) {
      const bestFit = Math.max(...vals);
      const spread = bestFit - Math.min(...vals);
      const gap = bestFit - fitAtTrack;
      const ratio = spread > 1e-6 ? gap / spread : 0;
      const best = marked.bestDistance;
      if (ctx.trackLength === best) {
        fitState = "fits";
        badges.push({ kind: "your-fit", petId: marked.petId, label: `Your horse fits ${ctx.trackLength}m` });
      } else if (gap < FIT_COBEST_GAP_PTS) {
        fitState = null; // co-best / within noise: no badge
      } else if (gap >= FIT_WEAK_GAP_PTS && ratio >= FIT_WEAK_RATIO) {
        fitState = "weak";
        badges.push({ kind: "poor-fit", petId: marked.petId, label: `Your horse is weak at ${ctx.trackLength}m, well below its ${best}m best` });
      } else {
        fitState = "off-best";
        badges.push({ kind: "off-best-fit", petId: marked.petId, label: `Your horse fits ${ctx.trackLength}m, though ${best}m is its best` });
      }
    }
  }
  const fitsTrack = fitState === "fits";

  const highEloCount = entrants.filter((e) => e.highElo && !e.isShark).length;
  const softField = sharkPetIds.length === 0 && highEloCount === 0;
  if (softField) badges.push({ kind: "soft-field", label: "Soft field, no proven threats" });

  // Recommendation and a one-line headline in plain, confident language.
  let recommendation: VerdictDTO["recommendation"];
  let headline: string;
  if (payoutTrap) {
    recommendation = "PASS";
    headline =
      sharkPetIds.length > 1
        ? `Pass. ${sharkPetIds.length} sharks and a top-2 payout.`
        : "Pass. A shark and a top-2 payout.";
  } else if (sharkPetIds.length >= 2) {
    recommendation = "CAUTION";
    headline = `Caution. ${sharkPetIds.length} sharks in the field.`;
  } else if (sharkPetIds.length === 1) {
    recommendation = fitsTrack ? "ENTERABLE" : "CAUTION";
    headline = fitsTrack
      ? "Enterable. One shark, but your horse fits this track."
      : "Caution. One shark to beat.";
  } else if (highEloCount >= 2) {
    recommendation = fitsTrack ? "ENTERABLE" : "CAUTION";
    headline = fitsTrack
      ? `Enterable. ${highEloCount} high-ELO horses, but yours fits this track.`
      : `Caution. No sharks, but ${highEloCount} high-ELO horses in form.`;
  } else {
    recommendation = "ENTERABLE";
    headline = fitsTrack
      ? "Enterable. Soft field and your horse fits."
      : softField
        ? "Enterable. Soft field, no proven threats."
        : "Enterable. One horse in form, the rest beatable.";
  }

  // Fit is independent of the field call: it adds a caveat to the headline and
  // never changes the field-driven recommendation. Both findings survive.
  if (fitState === "weak") {
    headline = headline.replace(/\.\s*$/, "") + ", but your horse is weak at this distance.";
  } else if (fitState === "off-best") {
    headline = headline.replace(/\.\s*$/, "") + ", though this is not your horse's best distance.";
  }

  return {
    recommendation,
    headline,
    badges,
    sharkPetIds,
    payoutTrap,
    caveat:
      "Reads field quality from race history. It cannot see real-time reveal state or daily exhaustion: the public cooldown endpoint reads 0 even for an exhausted horse.",
  };
}

// Helper for callers building entrant DTOs: shrunk win rate from raw record.
export function entrantShrunkWinRate(wins: number, racesRun: number): number {
  return shrunkWinRate(wins, racesRun);
}
