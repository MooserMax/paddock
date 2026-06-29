import type { SiteStats } from "@/lib/api/types";
import type { GigaStats } from "@/lib/telemetry";
import { formatInt, formatEth, formatUsd } from "@/lib/format";

// Comparable-L2 current-era gross margin (revenue minus L1 settlement cost, over revenue), from
// growthepie: Base ~99.0%, Arbitrum ~98.8% trailing-year. Abstract is NOT tracked by growthepie,
// so this is a peer-chain INFERENCE, never presented as Abstract's measured margin.
const ABSTRACT_MARGIN_EST = 0.99;

// A prominent, screenshottable Global Stats showcase: a titled card grid of the strongest
// macro numbers, every figure from real verified data (Paddock's own pet/race data plus
// the public Gigaverse /stats and the live jackpot pool). Crimson Pro serif numbers,
// JetBrains Mono micro-labels, gold accents on the ETH figures, a self-branding wordmark
// footer so a shared screenshot carries the Paddock mark. Nothing fabricated; honest about
// jackpots (pool shown, 0 won).
//
// itemStats is wired but optional: the on-chain item-spend pipeline (/api/v1/item-stats) is
// not live yet, so it is null and the item rows are omitted. When it lands it lights up. The
// item payment currency is NATIVE ETH (verified from the ItemMarketSystem source), not an
// ERC-20, so item spend will be denominated in ETH.
// Racing consumables only (dung + butterfly). NOT the whole-marketplace item total.
export interface GlobalItemStats {
  itemsBought: number;
  spendEthWei: string;
  uniqueBuyers: number;
  dungEthWei: string;
  butterflyEthWei: string;
}

// Total player gas (transaction fees) spent creating and entering races, summed from real
// receipts. SEPARATE from entry-fee volume (ETH staked) and item spend.
export interface GlobalRaceGas {
  feeEthWei: string;
  txCount: number;
}

type Stat = { value: string; label: string; sub?: string; accent?: string };

const ethStr = (wei: string | number, dp: number) => formatEth(Number(wei) / 1e18, dp);

export default function GlobalStats({ site, giga, itemStats, raceGas, ethUsd }: { site: SiteStats | null; giga: GigaStats | null; itemStats?: GlobalItemStats | null; raceGas?: GlobalRaceGas | null; ethUsd?: number | null }) {
  if (!site && !giga) return null;

  const stats: Stat[] = [];
  if (site) {
    stats.push({ value: formatInt(site.racesResolved), label: "Races run", sub: `of ${formatInt(site.racesCreated)} created` });
    stats.push({ value: formatInt(site.totalPets), label: "Giglings tracked" });
    stats.push({ value: formatInt(site.hatchedPets), label: "Hatched racers" });
  }
  if (giga) {
    stats.push({ value: formatInt(giga.uniqueRacers), label: "Unique racers" });
    stats.push({ value: formatInt(giga.totalEntries), label: "Race entries" });
    stats.push({ value: ethStr(giga.totalEntryFeeVolumeWei, 3), label: "Entry-fee volume", accent: "var(--gold)" });
    if (giga.jackpotPoolWei) stats.push({ value: ethStr(giga.jackpotPoolWei, 3), label: "Jackpot pool", sub: `${giga.jackpotWins} won so far`, accent: "var(--gold)" });
  }
  if (site?.recentBigSale) stats.push({ value: ethStr(site.recentBigSale.priceEth * 1e18, 3), label: "Top recent sale", accent: "var(--gold)" });
  if (itemStats) {
    // Racing consumables only (dung + butterfly), with the dung vs butterfly split as the sub.
    stats.push({ value: formatInt(itemStats.itemsBought), label: "Race items bought", sub: "dung + butterfly" });
    stats.push({
      value: ethStr(itemStats.spendEthWei, 4),
      label: "Spent on race items",
      sub: `dung ${(Number(itemStats.dungEthWei) / 1e18).toFixed(3)} · butterfly ${(Number(itemStats.butterflyEthWei) / 1e18).toFixed(3)} ETH`,
      accent: "var(--gold)",
    });
  }
  if (raceGas) {
    // Player gas fees = Abstract's REVENUE on Gigling Racing (create + enter tx fees, measured
    // on-chain). Shown in USD (derived from the live ETH rate x the stored ETH total, never
    // hardcoded); falls back to ETH if the rate is unavailable. Abstract margin (~99%) and the
    // estimated profit are peer-chain INFERENCES, clearly labelled est.
    const feeEth = Number(raceGas.feeEthWei) / 1e18;
    const profitEth = feeEth * ABSTRACT_MARGIN_EST;
    if (ethUsd && ethUsd > 0) {
      stats.push({ value: formatUsd(feeEth * ethUsd), label: "Player gas fees", sub: "create + enter, all time", accent: "var(--gold)" });
      stats.push({ value: "~99%", label: "Abstract margin", sub: "est., comparable-L2 (Base, Arbitrum)" });
      stats.push({ value: formatUsd(profitEth * ethUsd), label: "Est. Abstract profit", sub: "estimated", accent: "var(--gold)" });
    } else {
      // Live rate unavailable: show ETH rather than a wrong/blank dollar figure.
      stats.push({ value: ethStr(raceGas.feeEthWei, 4), label: "Player gas fees", sub: "create + enter, all time", accent: "var(--gold)" });
      stats.push({ value: "~99%", label: "Abstract margin", sub: "est., comparable-L2 (Base, Arbitrum)" });
      stats.push({ value: `${profitEth.toFixed(4)} ETH`, label: "Est. Abstract profit", sub: "estimated", accent: "var(--gold)" });
    }
  }

  return (
    <section className="mx-auto max-w-page px-4 py-12 md:px-6 md:py-16">
      <div className="overflow-hidden rounded-2xl border hairline" style={{ background: "var(--paper-raised)" }}>
        <div className="px-6 pt-7 md:px-8 md:pt-8">
          <p className="eyebrow" style={{ color: "var(--brick)" }}>Global stats</p>
          <h2 className="type-section mt-1 text-ink">Gigling Racing, by the numbers</h2>
          <p className="type-micro mt-1.5 normal-case text-ink-faint">All time, from on-chain and Gigaverse data. Live.</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-px md:grid-cols-4" style={{ background: "var(--line)" }}>
          {stats.map((s, i) => (
            <div key={i} className="px-6 py-6 md:px-8 md:py-7" style={{ background: "var(--paper-raised)" }}>
              <p className="font-serif text-3xl leading-none tabular-nums md:text-4xl" style={{ color: s.accent ?? "var(--ink)" }}>{s.value}</p>
              <p className="type-micro mt-2 uppercase tracking-wider text-ink-faint">{s.label}</p>
              {s.sub && <p className="type-micro mt-1 normal-case text-ink-faint">{s.sub}</p>}
            </div>
          ))}
        </div>

        {site && (
          <p className="type-micro px-6 pt-4 normal-case text-ink-faint md:px-8">
            Races run only counts races that actually filled &amp; ran.
          </p>
        )}

        {raceGas && (
          <p className="type-micro px-6 pt-2 normal-case text-ink-faint md:px-8">
            Player gas fees are measured on-chain. Margin and profit are estimated from comparable L2s (Base, Arbitrum) at ~99% current-era gross margin; Abstract-specific profit is not publicly reported. USD at live ETH price. Sources: growthepie, Coinbase.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 px-6 py-4 md:px-8" style={{ borderTop: "1px solid var(--line)" }}>
          <p className="text-sm tracking-[0.18em] text-ink-soft"><span style={{ color: "var(--green)" }}>✳</span>&nbsp;PADDOCK</p>
          <p className="type-micro normal-case text-ink-faint">The Open Intelligence Layer for Gigling Racing</p>
        </div>
      </div>
    </section>
  );
}
