import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { StableLeaderboardResponse } from "@/lib/api/types";
import LeaderboardTabs from "@/components/leaderboards/LeaderboardTabs";
import StableLeaderboardTable from "@/components/leaderboards/StableLeaderboardTable";

export const metadata: Metadata = {
  title: "Stable leaderboard",
  description: "The best stables in the game, ranked by proven roster quality: the shrunk average confirmed quality of each stable's proven horses. Quality, not size, not value.",
};

export const revalidate = 60;

export default async function StablesPage() {
  let board: StableLeaderboardResponse | null = null;
  try {
    board = await api.stables(100, 0, { revalidate: 60 });
  } catch {
    // empty state below
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">Ranked by proven roster quality</p>
        <h1 className="type-page-title mt-2 text-ink">The best stables in the game</h1>
      </header>

      <LeaderboardTabs active="stable" />

      <p className="type-micro mb-4 max-w-2xl normal-case leading-relaxed text-ink-faint">
        Shrunk average confirmed quality of each stable&apos;s proven horses. Quality, not size, not value. Thin rosters are pulled toward the population mean; stables need at least 3 proven horses to rank.
      </p>

      {!board || board.rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">No ranking yet</p>
          <p className="type-body mt-1 text-ink-soft">The stable board is still computing. Check back shortly.</p>
        </div>
      ) : (
        <StableLeaderboardTable rows={board.rows} total={board.total} />
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">
        Proven roster quality only, not racing skill and not wealth. Population mean {board ? board.meta.popMean.toFixed(1) : "..."}, shrinkage K {board ? board.meta.k : "..."}, both recomputed each run. Served by{" "}
        <Link href="/api/v1/stables" className="underline transition-paddock hover:text-glow">/api/v1/stables</Link>.
      </p>
    </div>
  );
}
