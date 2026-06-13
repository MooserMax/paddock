import { shrunkWinRate } from "./engine";
import type { RaceEntrantDTO, VerdictDTO, VerdictBadge } from "../api/types";

// The scanner's verdict logic. It does not show data, it gives a call. Field
// quality is read from history; what it cannot know (real-time reveal state and
// daily exhaustion) is stated plainly in the caveat, never papered over.

// A shark is a proven, fearsome winner. Calibrated to the real distribution:
// the highest shrunk win rate in the game is ~49% (Bayesian shrinkage toward the
// 14.18% baseline makes 60% statistically unreachable), so a fixed 0.60 bar would
// never fire. 0.30 marks the top ~1.6% of the field (65 of 4,061 racers), p98-p99
// of shrunk win rate: rare enough to mean something, reachable enough to fire.
export const SHARK_WIN_RATE = 0.3;

export interface VerdictContext {
  payoutBps: number[] | null;
  eloThreshold: number; // 90th percentile of the live ELO ladder, computed upstream
  markedPetId?: number; // "your horse" for the YOUR FIT call
  trackLength: number | null;
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

  let yourFit: boolean | null = null;
  if (ctx.markedPetId != null) {
    const mine = entrants.find((e) => e.petId === ctx.markedPetId);
    if (mine) {
      yourFit = mine.bestDistance === ctx.trackLength;
      badges.push({
        kind: "your-fit",
        petId: mine.petId,
        label: yourFit
          ? `Your horse fits ${ctx.trackLength}m`
          : `Your horse prefers ${mine.bestDistance}m`,
      });
    }
  }

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
    recommendation = yourFit ? "ENTERABLE" : "CAUTION";
    headline = yourFit
      ? "Enterable. One shark, but your horse fits this track."
      : "Caution. One shark to beat.";
  } else if (highEloCount >= 2) {
    recommendation = yourFit ? "ENTERABLE" : "CAUTION";
    headline = yourFit
      ? `Enterable. ${highEloCount} high-ELO horses, but yours fits this track.`
      : `Caution. No sharks, but ${highEloCount} high-ELO horses in form.`;
  } else {
    recommendation = "ENTERABLE";
    headline = yourFit
      ? "Enterable. Soft field and your horse fits."
      : softField
        ? "Enterable. Soft field, no proven threats."
        : "Enterable. One horse in form, the rest beatable.";
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
