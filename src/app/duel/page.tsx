import type { Metadata } from "next";
import { Suspense } from "react";
import { getDuelGlobalStats, getDuelTraining } from "@/lib/api/queries";
import { fetchDuelConfig } from "@/lib/duel";
import { formatInt, formatEth } from "@/lib/format";
import DuelFeed from "@/components/duel/DuelFeed";
import DuelStudio from "@/components/duel/DuelStudio";
import BreedingExplainer from "@/components/duel/BreedingExplainer";

const GIGA_DUEL_URL = "https://gigaverse.io/duel";

export const metadata: Metadata = {
  title: "Duel",
  description: "A breeding-decision tool for Gigling duels: scan your stable for the best pairings toward your goal, see who fell and what it produced, and decide if it is worth it. Built on the official Gigaverse odds tables and checked against real resolved duels on-chain.",
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

  const feeEth = stats ? formatEth(Number(stats.challengeFeesWei) / 1e18, 3).replace(" ETH", "") : "0";
  const rar = training?.aggregates.rarity;
  const exp = training?.officialExpected;
  const open = training?.open;
  const minFeeEth = open ? formatEth(Number(open.minFeeWei) / 1e18, 4).replace(" ETH", "") : "0";
  type Tile = { v: string; l: string; sub: string; unit?: "ETH"; accent?: string; href?: string };
  const tiles: Tile[] = stats
    ? [
        { v: formatInt(stats.duelsResolved), l: "Duels so far", sub: "Giglings bred via combat" },
        // RARITY CLIMBS: the number breeders care about, observed vs official in one tile.
        ...(rar ? [{ v: `${rar.climb} of ${rar.n}`, l: "Rarity climbs", sub: exp ? `official odds expect ~${exp.climbPct}%` : "offspring climbed a tier", accent: "var(--gold)" as const }] : []),
        // OPEN CHALLENGES: the only actionable-right-now number; links to the game lobby.
        ...(open ? [{ v: formatInt(open.count), l: "Open challenges", sub: `fees from ${minFeeEth} ETH`, accent: "var(--green)" as const, href: GIGA_DUEL_URL }] : []),
        { v: feeEth, l: "Challenge fees", sub: "total, paid by challengers", unit: "ETH" as const },
        // MODEL ACCURACY, upgraded to observed vs official.
        ...(rar && rar.n > 0 ? [{ v: `${rar.hold}/${rar.n}`, l: "Rarity held", sub: exp ? `official expected ~${exp.holdPct}%` : "held the lower parent", accent: "var(--cyan)" as const }] : []),
        // GENERATION FRONTIER: newsworthy the day it ticks to 3.
        ...(training?.maxGeneration ? [{ v: `gen ${training.maxGeneration}`, l: "Generation frontier", sub: "highest Duelborn minted" }] : []),
      ]
    : [];

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow" style={{ color: "var(--brick)" }}>Breeding via combat</p>
        <h1 className="type-page-title mt-2 text-ink">Your stable, ready to breed</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          Every duel pairs one male and one female; one is permanently destroyed and becomes the Duelborn. Scan your stable to rank the best pairings toward your goal, preview exactly what a pairing produces, and decide if it is worth it.
        </p>
      </header>

      {/* Scan -> ranked recommender (hero after a scan) -> manual preview. Wrapped in Suspense
          because it reads URL params (deep links) via useSearchParams. */}
      <Suspense fallback={<div className="type-data text-ink-faint">Loading the breeding studio...</div>}>
        <DuelStudio minRaces={config?.minRacesToDuel ?? 40} modelN={training?.n ?? 0} accuracy={training?.accuracy ?? null} />
      </Suspense>

      {/* Breeder-relevant stat tiles: official odds vs observed, plus the actionable open-challenges. */}
      {stats && (
        <div className="mt-10 overflow-hidden rounded-xl border hairline" style={{ background: "var(--paper-raised)" }}>
          <div className="grid grid-cols-2 gap-px md:grid-cols-3 lg:grid-cols-6" style={{ background: "var(--line)" }}>
            {tiles.map((t, i) => {
              const inner = (
                <>
                  <p className="font-serif text-2xl leading-none tabular-nums md:text-3xl" style={{ color: t.unit ? "var(--gold)" : t.accent ?? "var(--ink)" }}>
                    {t.v}{t.unit ? ` ${t.unit}` : ""}
                  </p>
                  <p className="type-micro mt-2 uppercase tracking-wider text-ink-faint">{t.l}</p>
                  <p className="type-micro mt-0.5 normal-case text-ink-faint">{t.sub}{t.href ? " ->" : ""}</p>
                </>
              );
              return t.href ? (
                <a key={i} href={t.href} target="_blank" rel="noopener noreferrer" className="transition-paddock block px-5 py-5 hover:bg-paper-sunken" style={{ background: "var(--paper-raised)" }}>{inner}</a>
              ) : (
                <div key={i} className="px-5 py-5" style={{ background: "var(--paper-raised)" }}>{inner}</div>
              );
            })}
          </div>
          <p className="type-micro px-5 py-3 normal-case text-ink-faint" style={{ borderTop: "1px solid var(--line)" }}>
            Rarity, trait-tier, faction, glue, and generation odds are the official Gigaverse tables; the observed columns are Paddock&apos;s {training?.n ?? 0} real resolved duels as a check. Traits and exact stats reveal only through racing and are not predicted.
          </p>
        </div>
      )}

      {/* Part 4: the short course, collapsed by default. */}
      {training && (
        <BreedingExplainer climbs={training.aggregates.rarity.climb} n={training.n} openCount={training.open.count} minFee={minFeeEth} />
      )}

      {/* Part 5: the evidence base and proof, below the recommender. */}
      <section className="mt-10">
        <h2 className="type-section mb-1 text-ink">Every resolved duel, and what it teaches</h2>
        <p className="type-micro mb-3 normal-case text-ink-faint">
          All {training?.n ?? 0} breedings on-chain. The odds above come from these.
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
