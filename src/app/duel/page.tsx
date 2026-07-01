import type { Metadata } from "next";
import { Suspense } from "react";
import { getDuelGlobalStats, getDuelTraining } from "@/lib/api/queries";
import { fetchDuelConfig } from "@/lib/duel";
import { formatInt, formatEth } from "@/lib/format";
import DuelFeed from "@/components/duel/DuelFeed";
import DuelStudio from "@/components/duel/DuelStudio";

export const metadata: Metadata = {
  title: "Duel",
  description: "A breeding-decision tool for Gigling duels: scan your stable for the best pairings toward your goal, see who fell and what it produced, and decide if it is worth it. Modeled from real resolved duels on-chain. Read-only, Paddock never signs.",
};

export const revalidate = 30;

// FUTURE (roadmap, not built here): a "Duel Finder" could reframe OPEN listings (phase 1) into live
// duels a user could enter, ranked by host-pet quality and fee fairness, the duel-world sibling of
// Race Finder. Out of scope for this page; the feed below teaches from RESOLVED duels only.

export default async function DuelPage() {
  const [stats, config, training] = await Promise.all([
    getDuelGlobalStats(),
    fetchDuelConfig(),
    getDuelTraining(),
  ]);

  const acc = training?.accuracy?.rarity ?? null;
  const feeEth = stats ? formatEth(Number(stats.challengeFeesWei) / 1e18, 3).replace(" ETH", "") : "0";
  const tiles = stats
    ? [
        { v: formatInt(stats.duelsResolved), l: "Duels so far", sub: "Giglings bred via combat" },
        { v: `${stats.gen2Pct ?? 0}%`, l: "Produce a gen-2+", sub: `${formatInt(stats.gen2Plus ?? stats.duelbornMinted)} Duelborn minted` },
        { v: formatInt(stats.parentsBurned ?? stats.duelsResolved), l: "Parents burned", sub: "permanently destroyed" },
        { v: feeEth, l: "Challenge fees", sub: "paid by challengers", unit: "ETH" as const },
        ...(acc && acc.n > 0
          ? [{ v: `${acc.correct}/${acc.n}`, l: "Model accuracy", sub: "rarity predicted right", accent: "var(--cyan)" as const }]
          : []),
      ]
    : [];

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow" style={{ color: "var(--brick)" }}>Breeding via combat</p>
        <h1 className="type-page-title mt-2 text-ink">Your stable, ready to breed</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          Every duel pairs one male and one female; one is permanently destroyed and becomes the Duelborn. Scan your stable to rank the best pairings toward your goal, preview exactly what a pairing produces, and decide if it is worth it. Read-only, Paddock never signs.
        </p>
      </header>

      {/* Scan -> ranked recommender (hero after a scan) -> manual preview. Wrapped in Suspense
          because it reads URL params (deep links) via useSearchParams. */}
      <Suspense fallback={<div className="type-data text-ink-faint">Loading the breeding studio...</div>}>
        <DuelStudio minRaces={config?.minRacesToDuel ?? 40} modelN={training?.n ?? 0} accuracy={training?.accuracy ?? null} />
      </Suspense>

      {/* Breeder-relevant stat tiles, on-chain-derived, plus the model-accuracy proof tile. */}
      {stats && (
        <div className="mt-10 overflow-hidden rounded-xl border hairline" style={{ background: "var(--paper-raised)" }}>
          <div className="grid grid-cols-2 gap-px md:grid-cols-3 lg:grid-cols-5" style={{ background: "var(--line)" }}>
            {tiles.map((t, i) => (
              <div key={i} className="px-5 py-5" style={{ background: "var(--paper-raised)" }}>
                <p className="font-serif text-2xl leading-none tabular-nums md:text-3xl" style={{ color: t.unit ? "var(--gold)" : t.accent ?? "var(--ink)" }}>
                  {t.v}{t.unit ? ` ${t.unit}` : ""}
                </p>
                <p className="type-micro mt-2 uppercase tracking-wider text-ink-faint">{t.l}</p>
                <p className="type-micro mt-0.5 normal-case text-ink-faint">{t.sub}</p>
              </div>
            ))}
          </div>
          <p className="type-micro px-5 py-3 normal-case text-ink-faint" style={{ borderTop: "1px solid var(--line)" }}>
            Modeled from {training?.n ?? 0} resolved duels on-chain. Rarity, generation, gender, faction, and stat floor are data-backed; traits and exact stats reveal only through racing and are not predicted.
          </p>
        </div>
      )}

      {/* Part 5: the evidence base and proof, below the recommender. */}
      <section className="mt-10">
        <h2 className="type-section mb-1 text-ink">Every resolved duel, and what it teaches</h2>
        <p className="type-micro mb-3 normal-case text-ink-faint">
          {training?.n ?? 0} real breedings on-chain. This is the evidence the model above is fit on.
        </p>
        {training ? (
          <DuelFeed training={{ n: training.n, rows: training.rows, aggregates: training.aggregates }} />
        ) : (
          <p className="type-data text-ink-faint">The training set has not been fit yet.</p>
        )}
      </section>
    </div>
  );
}
