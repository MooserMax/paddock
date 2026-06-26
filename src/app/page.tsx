import Link from "next/link";
import { api } from "@/lib/api/client";
import type { SiteStats, LeaderboardResponse, RecentWinsResponse } from "@/lib/api/types";
import WalletSearch from "@/components/WalletSearch";
import GettingStarted from "@/components/home/GettingStarted";
import RarityBadge from "@/components/RarityBadge";
import RecentWins from "@/components/home/RecentWins";
import { getRecentWins } from "@/lib/api/queries";
import { formatEth, formatInt, formatScore, formatPct } from "@/lib/format";

export const revalidate = 60;

export default async function Home() {
  let stats: SiteStats | null = null;
  let board: LeaderboardResponse | null = null;
  let recentWins: RecentWinsResponse = { wins: [], ethUsd: null, fetchedAt: new Date().toISOString() };
  try {
    [stats, board, recentWins] = await Promise.all([api.stats(), api.leaderboard("cq", 6), getRecentWins(12)]);
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

          {stats && (
            <div className="assemble mt-10 flex flex-wrap items-center gap-x-8 gap-y-3" style={{ animationDelay: "160ms" }} aria-label="Live coverage">
              <LiveStat value={formatInt(stats.racesResolved)} label="races resolved" pulse />
              <LiveStat value={formatInt(stats.totalPets)} label="Giglings tracked" />
              <LiveStat value={formatInt(stats.hatchedPets)} label="hatched racers" />
              {stats.recentBigSale && <LiveStat value={formatEth(stats.recentBigSale.priceEth, 3)} label="top recent sale" />}
            </div>
          )}
          {stats && stats.racesAbandoned > 0 && (
            <p className="assemble type-micro mt-3 normal-case text-ink-faint" style={{ animationDelay: "200ms" }}>
              That is races that actually ran. A further {formatInt(stats.racesAbandoned)} were created but never drew enough entrants to start, so we count them separately rather than inflate the total.
            </p>
          )}
        </div>
      </section>

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

function LiveStat({ value, label, pulse = false }: { value: string; label: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {pulse && <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse-soft" style={{ background: "var(--green)" }} aria-hidden />}
      <span className="type-data tabular-nums text-ink">{value}</span>
      <span className="type-micro uppercase text-ink-faint">{label}</span>
    </div>
  );
}
