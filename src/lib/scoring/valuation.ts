import { MIN_VALUATION_COMPS } from "./constants";

export interface Comp {
  tokenId: number;
  priceEth: number;
  soldAt: string;
  confirmedQuality: number;
}

// A sold pet, with the score state we compare against. Reveal and quality are
// snapshotted from current scores; sale prices are historical.
export interface SoldPet {
  tokenId: number;
  rarity: number | null;
  confirmedQuality: number;
  revealProgress: number;
  priceEth: number;
  soldAt: string;
}

export interface ValuationBand {
  low: number | null;
  high: number | null;
  comps: Comp[];
  thin: boolean;
  note: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Estimate a valuation band from sale comps: same rarity, similar confirmed
// quality, similar reveal state. Returns an explicit band with the comps, or a
// thin-comps note where the market is too sparse to quote. Never a fake number.
export function valuationBand(
  target: { rarity: number | null; confirmedQuality: number; revealProgress: number },
  sold: SoldPet[],
  opts: { qualityBand?: number; revealBand?: number; maxComps?: number } = {}
): ValuationBand {
  const qualityBand = opts.qualityBand ?? 12;
  const revealBand = opts.revealBand ?? 0.35;
  const maxComps = opts.maxComps ?? 8;

  const matches = sold
    .filter((s) => s.rarity === target.rarity)
    .filter((s) => Math.abs(s.confirmedQuality - target.confirmedQuality) <= qualityBand)
    .filter((s) => Math.abs(s.revealProgress - target.revealProgress) <= revealBand)
    .filter((s) => s.priceEth > 0)
    .sort((a, b) => (a.soldAt < b.soldAt ? 1 : -1))
    .slice(0, maxComps);

  if (matches.length < MIN_VALUATION_COMPS) {
    return {
      low: null,
      high: null,
      comps: matches.map((m) => ({
        tokenId: m.tokenId,
        priceEth: m.priceEth,
        soldAt: m.soldAt,
        confirmedQuality: m.confirmedQuality,
      })),
      thin: true,
      note:
        matches.length === 0
          ? "No comparable sales yet for this rarity and quality band."
          : `Only ${matches.length} comparable sale(s); too thin to quote a band.`,
    };
  }

  const prices = matches.map((m) => m.priceEth).sort((a, b) => a - b);
  return {
    low: percentile(prices, 0.25),
    high: percentile(prices, 0.75),
    comps: matches.map((m) => ({
      tokenId: m.tokenId,
      priceEth: m.priceEth,
      soldAt: m.soldAt,
      confirmedQuality: m.confirmedQuality,
    })),
    thin: false,
    note: `Band is the interquartile range of ${matches.length} comparable sales.`,
  };
}
