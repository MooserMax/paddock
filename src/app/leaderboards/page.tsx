import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { LeaderboardMetric, LeaderboardResponse } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import { formatEth, formatPct, formatScore, shortAddress } from "@/lib/format";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "The best Giglings by confirmed quality, ELO, win rate (shrunk, with raw shown), and earnings. Every column explained.",
};

export const revalidate = 120;

const METRICS: { key: LeaderboardMetric; label: string; unit: string }[] = [
  { key: "cq", label: "Confirmed quality", unit: "" },
  { key: "elo", label: "ELO", unit: "" },
  { key: "winrate", label: "Win rate", unit: "shrunk" },
  { key: "earnings", label: "Earnings", unit: "ETH" },
];

function valueFor(metric: LeaderboardMetric, value: number): string {
  if (metric === "cq") return formatScore(value);
  if (metric === "elo") return String(Math.round(value));
  if (metric === "winrate") return formatPct(value);
  return formatEth(value, 4);
}

export default async function LeaderboardsPage({ searchParams }: { searchParams: { metric?: string } }) {
  const metric = (METRICS.find((m) => m.key === searchParams.metric)?.key ?? "cq") as LeaderboardMetric;
  let board: LeaderboardResponse | null = null;
  try {
    board = await api.leaderboard(metric, 50, 0, { revalidate: 120 });
  } catch {
    // empty state below
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">Ranked from our database</p>
        <h1 className="type-page-title mt-2 text-ink">Leaderboards</h1>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Leaderboard metric">
        {METRICS.map((m) => (
          <Link
            key={m.key}
            href={`/leaderboards?metric=${m.key}`}
            aria-current={metric === m.key ? "true" : undefined}
            className="transition-paddock rounded-full border px-3.5 py-1.5"
            style={metric === m.key ? { borderColor: "var(--glow)" } : { borderColor: "var(--line)" }}
          >
            <span className={`type-micro uppercase tracking-wider ${metric === m.key ? "text-ink" : "text-ink-faint"}`}>{m.label}</span>
          </Link>
        ))}
      </nav>

      {board && <p className="type-micro mb-4 max-w-2xl normal-case leading-relaxed text-ink-faint">{board.meta.explanation}</p>}

      {!board || board.rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">No ranking yet</p>
          <p className="type-body mt-1 text-ink-soft">This board has no entries to show.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border hairline">
          <div className="hidden grid-cols-[2.5rem_1fr_7rem_8rem_5rem_7rem_6rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
            <span className="type-micro uppercase text-ink-faint">#</span>
            <span className="type-micro uppercase text-ink-faint">Gigling</span>
            <span className="type-micro uppercase text-ink-faint">{METRICS.find((m) => m.key === metric)!.label}</span>
            <span className="type-micro uppercase text-ink-faint">Owner</span>
            <span className="type-micro text-right uppercase text-ink-faint">ELO</span>
            <span className="type-micro text-right uppercase text-ink-faint">Win (raw)</span>
            <span className="type-micro text-right uppercase text-ink-faint">Races</span>
          </div>
          {board.rows.map((r) => (
            // Row is a div, not a link, so the Gigling and Owner cells can each be
            // their own link (a row-wide anchor cannot legally wrap a second one).
            <div
              key={r.petId}
              className="transition-paddock grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b hairline px-4 py-3 last:border-0 hover:bg-paper-raised md:grid-cols-[2.5rem_1fr_7rem_8rem_5rem_7rem_6rem]"
            >
              <span className="type-data tabular-nums text-ink-faint">{r.rank}</span>
              <Link href={`/pet/${r.petId}`} className="flex min-w-0 items-center gap-2 transition-paddock hover:text-glow">
                <span className="type-data truncate text-ink">{r.name ?? `#${r.petId}`}</span>
                <RarityBadge rarity={r.rarity.value} size="sm" />
              </Link>
              <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>
                {valueFor(metric, r.value)}
              </span>
              {r.ownerAddress ? (
                <Link
                  href={`/wallet/${r.ownerAddress}`}
                  className="type-data hidden truncate tabular-nums text-ink-faint transition-paddock hover:text-glow md:block"
                  title={r.ownerAddress}
                >
                  {shortAddress(r.ownerAddress)}
                </Link>
              ) : (
                <span className="type-data hidden tabular-nums text-ink-faint md:block">-</span>
              )}
              <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">{r.elo ?? "-"}</span>
              <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">
                {formatPct(r.shrunkWinRate)}
                <span className="text-ink-faint"> ({r.rawWinRate != null ? formatPct(r.rawWinRate) : "-"})</span>
              </span>
              <span className="type-data hidden text-right tabular-nums text-ink-faint md:block">{r.racesRun}</span>
            </div>
          ))}
        </div>
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">
        Win rate is Bayesian-shrunk so small samples do not top the board; the raw record is shown in parentheses. Served by{" "}
        <Link href={`/api/v1/leaderboard?metric=${metric}`} className="underline transition-paddock hover:text-glow">/api/v1/leaderboard</Link>.
      </p>
    </div>
  );
}
