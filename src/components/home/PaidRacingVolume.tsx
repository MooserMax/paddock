import type { PaidVolume24hHome } from "@/lib/api/queries";
import { formatUsd, formatEth, formatInt } from "@/lib/format";

// Standalone tile in the band between the Global Stats panel and Recent Wins: trailing-24h PAID
// racing volume = entry fees STAKED into paid races (money in, NOT payouts). Shown in USD from
// the live ETH rate (the stored ETH wei is the source of truth; never hardcoded), with the ETH
// equivalent and an honest note that most races are free so only paid entries count.
export default function PaidRacingVolume({ data, ethUsd }: { data: PaidVolume24hHome | null; ethUsd?: number | null }) {
  if (!data) return null;
  const eth = Number(data.volumeWei) / 1e18;
  const value = ethUsd && ethUsd > 0 ? formatUsd(eth * ethUsd) : formatEth(eth, 4);

  return (
    <section className="mx-auto max-w-page px-4 pt-4 pb-2 md:px-6">
      <div
        className="flex flex-col gap-3 rounded-2xl border hairline px-6 py-6 sm:flex-row sm:items-end sm:justify-between md:px-8 md:py-7"
        style={{ background: "var(--paper-raised)" }}
      >
        <div>
          <p className="eyebrow" style={{ color: "var(--brick)" }}>Live volume</p>
          <p className="font-serif text-3xl leading-none tabular-nums md:text-4xl" style={{ color: "var(--gold)" }}>{value}</p>
          <p className="type-micro mt-2 uppercase tracking-wider text-ink-faint">24h Paid Racing Volume</p>
        </div>
        <p className="type-micro max-w-sm normal-case leading-relaxed text-ink-faint sm:text-right">
          Entry fees staked into paid races over the last 24h ({formatEth(eth, 4)}, {formatInt(data.paidEntries)} paid entries). Money in, not payouts. Most races run free, so only paid entries count.
        </p>
      </div>
    </section>
  );
}
