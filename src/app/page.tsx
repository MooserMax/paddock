import Link from "next/link";
import { api } from "@/lib/api/client";
import type { SiteStats, LeaderboardResponse, RecentWinsResponse } from "@/lib/api/types";
import WalletSearch from "@/components/WalletSearch";
import GettingStarted from "@/components/home/GettingStarted";
import RarityBadge from "@/components/RarityBadge";
import RecentWins from "@/components/home/RecentWins";
import GlobalStats from "@/components/home/GlobalStats";
import PaidRacingVolume from "@/components/home/PaidRacingVolume";
import { getRecentWins, getItemSpendHomeStats, getRaceGasHomeStat, getPaidVolume24h, getJuiceRevenue, type ItemSpendHome, type RaceGasHome, type PaidVolume24hHome, type JuiceRevenueHome } from "@/lib/api/queries";
import { fetchGigaStats, fetchEthUsd, type GigaStats } from "@/lib/telemetry";
import { formatScore, formatPct } from "@/lib/format";

export const revalidate = 60;

export default async function Home() {
  let stats: SiteStats | null = null;
  let board: LeaderboardResponse | null = null;
  let recentWins: RecentWinsResponse = { wins: [], ethUsd: null, fetchedAt: new Date().toISOString() };
  let giga: GigaStats | null = null;
  let itemStats: ItemSpendHome | null = null;
  let raceGas: RaceGasHome | null = null;
  let ethUsd: number | null = null;
  let paidVol: PaidVolume24hHome | null = null;
  let juice: JuiceRevenueHome | null = null;
  try {
    [stats, board, recentWins, giga, itemStats, raceGas, ethUsd, paidVol, juice] = await Promise.all([api.stats(), api.leaderboard("cq", 6), getRecentWins(12), fetchGigaStats(), getItemSpendHomeStats(), getRaceGasHomeStat(), fetchEthUsd(), getPaidVolume24h(), getJuiceRevenue()]);
  } catch {
    // The hero still renders without live numbers; never a blank crash.
  }

  return (
    <div>
      {/* Hero: the first five seconds. Alive, intelligent, one primary action. */}
      <section className="relative overflow-hidden border-b hairline bg-starfield">
        <div className="mx-auto max-w-page px-4 py-16 md:px-6 md:py-24">
          <p className="eyebrow assemble">The open intelligence layer for Gigling Racing</p>
          <h1 className="type-page-title assemble mt-3 max-w-3xl text-balance text-ink" style={{ animationDelay: "40ms" }}>
            Every Gigling, graded. <span className="asterisk">Know your stable. Know your odds.</span>
          </h1>
          <p className="type-body assemble mt-4 max-w-xl text-ink-soft" style={{ animationDelay: "80ms" }}>
            Paste a wallet and read its stable like a scout: proven quality, hidden upside, which horse to race next, and what it is worth. Powered by a public API anyone can build on.
          </p>

          <div className="assemble mt-8 max-w-2xl" style={{ animationDelay: "120ms" }}>
            <WalletSearch size="lg" />
          </div>

          {/* Getting-started guide: what to do, one tile per feature. */}
          <GettingStarted />
        </div>
      </section>

      {/* Global Stats showcase: the macro numbers, screenshottable, self-branding. */}
      <GlobalStats site={stats} giga={giga} itemStats={itemStats} raceGas={raceGas} juice={juice} ethUsd={ethUsd} />

      {/* 24h paid racing volume: its own tile in the band above Recent Wins. */}
      <PaidRacingVolume data={paidVol} ethUsd={ethUsd} />

      {/* Recent paid-race wins: live money moving, the social proof slot. */}
      <RecentWins initial={recentWins} />

      {/* Top confirmed horses: the engine's headline output. */}
      {board && board.rows.length > 0 && (
        <section className="mx-auto max-w-page px-4 pb-16 md:px-6">
          <div className="mb-5 flex items-baseline justify-between">
            <div>
              <p className="eyebrow">Confirmed quality, proven</p>
              <h2 className="type-section text-ink">Best horses in the game right now</h2>
            </div>
            <Link href="/leaderboards" className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">
              Full board
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border hairline">
            {board.rows.map((r, i) => (
              <Link
                key={r.petId}
                href={`/pet/${r.petId}`}
                className="transition-paddock flex items-center gap-4 border-b hairline px-4 py-3 last:border-0 hover:bg-paper-raised"
                style={{ background: i % 2 ? "transparent" : "color-mix(in srgb, var(--paper-raised) 40%, transparent)" }}
              >
                <span className="type-data w-6 tabular-nums text-ink-faint">{r.rank}</span>
                <span className="type-data flex-1 text-ink">{r.name ?? `#${r.petId}`}</span>
                <RarityBadge rarity={r.rarity.value} size="sm" />
                <span className="type-data hidden w-24 text-right tabular-nums text-ink-soft sm:block">elo {r.elo ?? "-"}</span>
                <span className="type-data hidden w-24 text-right tabular-nums text-ink-soft sm:block">{formatPct(r.shrunkWinRate)} win</span>
                <span className="type-data w-16 text-right tabular-nums" style={{ color: "var(--gold)" }}>{formatScore(r.value)}</span>
              </Link>
            ))}
          </div>
          <p className="type-micro mt-3 normal-case text-ink-faint">{board.meta.explanation}</p>
        </section>
      )}
    </div>
  );
}

