import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { LeaderboardMetric, LeaderboardResponse } from "@/lib/api/types";
import LeaderboardTable from "@/components/leaderboards/LeaderboardTable";
import LeaderboardTabs from "@/components/leaderboards/LeaderboardTabs";
import SpenderBoard from "@/components/leaderboards/SpenderBoard";
import { getItemLeaderboardSnapshot } from "@/lib/api/queries";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "The best Giglings by confirmed quality, ELO, win rate (shrunk, with raw shown), earnings, and reveal-adjusted upside. Every column explained.",
};

// Short window so the board reflects current rankings AND freshly-resolved owner
// usernames within ~30s (the data layer is always fresh; this is the render cache).
export const revalidate = 30;

const METRICS: { key: LeaderboardMetric; label: string }[] = [
  { key: "cq", label: "Confirmed quality" },
  { key: "elo", label: "ELO" },
  { key: "winrate", label: "Win rate" },
  { key: "earnings", label: "Earnings" },
  { key: "upside", label: "Upside" },
];

export default async function LeaderboardsPage(props: { searchParams: Promise<{ metric?: string }> }) {
  const searchParams = await props.searchParams;

  // Top spenders is a sibling board within the same tab family: same page, no route change.
  // It reads the precomputed on-chain item-spend snapshot (no chain at request time) and
  // degrades to a clean "coming soon" until the indexer has run.
  if (searchParams.metric === "spenders") {
    const spenderBoard = await getItemLeaderboardSnapshot();
    return (
      <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
        <header className="mb-6">
          <p className="eyebrow">On-chain item spend</p>
          <h1 className="type-page-title mt-2 text-ink">Leaderboards</h1>
        </header>
        <LeaderboardTabs active="spenders" />
        <SpenderBoard board={spenderBoard} />
      </div>
    );
  }

  const metric = (METRICS.find((m) => m.key === searchParams.metric)?.key ?? "cq") as LeaderboardMetric;
  let board: LeaderboardResponse | null = null;
  try {
    // Up to 100 rows; the table windows them so the initial paint stays light.
    board = await api.leaderboard(metric, 100, 0, { revalidate: 30 });
  } catch {
    // empty state below
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">Ranked from our database</p>
        <h1 className="type-page-title mt-2 text-ink">Leaderboards</h1>
      </header>

      <LeaderboardTabs active={metric} />

      {board && <p className="type-micro mb-4 max-w-2xl normal-case leading-relaxed text-ink-faint">{board.meta.explanation}</p>}

      {!board || board.rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">No ranking yet</p>
          <p className="type-body mt-1 text-ink-soft">This board has no entries to show.</p>
        </div>
      ) : (
        <LeaderboardTable rows={board.rows} metric={metric} total={board.total} />
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">
        {metric === "winrate" && "Win rate is Bayesian-shrunk so small samples do not top the board; the raw record is shown in parentheses. "}
        {metric === "upside" && "Upside is potential, never proof, and here it is adjusted for reveal level so the board surfaces promise, not mere ignorance. "}
        Served by{" "}
        <Link href={`/api/v1/leaderboard?metric=${metric}`} className="underline transition-paddock hover:text-glow">/api/v1/leaderboard</Link>.
      </p>
    </div>
  );
}
