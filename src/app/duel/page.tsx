import type { Metadata } from "next";
import { getDuelGlobalStats } from "@/lib/api/queries";
import { fetchDuelFeed, fetchDuelConfig } from "@/lib/duel";
import { formatInt, formatEth } from "@/lib/format";
import DuelFeed from "@/components/duel/DuelFeed";
import DuelStudio from "@/components/duel/DuelStudio";

export const metadata: Metadata = {
  title: "Duel",
  description: "A breeding-decision tool for Gigling duels: scan your stable for who is ready to breed (and who is one duel from destruction), preview exactly what a pairing produces, and decide if it is worth it. Read-only, every input from Paddock's own race data.",
};

export const revalidate = 30;

export default async function DuelPage() {
  const [stats, config, feed] = await Promise.all([
    getDuelGlobalStats(),
    fetchDuelConfig(),
    fetchDuelFeed(3),
  ]);

  // D. STAT TILES reframed for a decision-maker: breeder-relevant facts, all on-chain-derived.
  const feeEth = stats ? formatEth(Number(stats.challengeFeesWei) / 1e18, 3).replace(" ETH", "") : "0";
  const tiles = stats
    ? [
        { v: formatInt(stats.duelsResolved), l: "Duels so far", sub: "Giglings bred via combat" },
        { v: `${stats.gen2Pct ?? 0}%`, l: "Produce a gen-2+", sub: `${formatInt(stats.gen2Plus ?? stats.duelbornMinted)} Duelborn minted` },
        { v: formatInt(stats.parentsBurned ?? stats.duelsResolved), l: "Parents burned", sub: "permanently destroyed" },
        { v: feeEth, l: "Challenge fees", sub: "paid by challengers", unit: "ETH" as const },
      ]
    : [];

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow" style={{ color: "var(--brick)" }}>Breeding via combat</p>
        <h1 className="type-page-title mt-2 text-ink">Your stable, ready to breed</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          Every duel pairs one male and one female; one is permanently destroyed and becomes the Duelborn. Scan your stable to see who is eligible and who is one duel from death, preview exactly what a pairing produces, then do it in Gigaverse. Read-only, Paddock never signs.
        </p>
      </header>

      {/* A + B: the decision flow (scan -> select -> preview) is the hero. */}
      <DuelStudio minRaces={config?.minRacesToDuel ?? 40} />

      {/* D: breeder-relevant stat tiles, on-chain-derived. */}
      {stats && (
        <div className="mt-10 overflow-hidden rounded-xl border hairline" style={{ background: "var(--paper-raised)" }}>
          <div className="grid grid-cols-2 gap-px md:grid-cols-4" style={{ background: "var(--line)" }}>
            {tiles.map((t, i) => (
              <div key={i} className="px-5 py-5" style={{ background: "var(--paper-raised)" }}>
                <p className="font-serif text-2xl leading-none tabular-nums md:text-3xl" style={{ color: t.unit ? "var(--gold)" : "var(--ink)" }}>
                  {t.v}{t.unit ? ` ${t.unit}` : ""}
                </p>
                <p className="type-micro mt-2 uppercase tracking-wider text-ink-faint">{t.l}</p>
                <p className="type-micro mt-0.5 normal-case text-ink-faint">{t.sub}</p>
              </div>
            ))}
          </div>
          <p className="type-micro px-5 py-3 normal-case text-ink-faint" style={{ borderTop: "1px solid var(--line)" }}>
            Measured on-chain from PetDuelingSystem. Current duels are mostly free (challenge fees near zero). The breeding odds model (rarity %, stat ranges, trait star-tiers, fall probability) is in progress; the deterministic facts above and in the preview are verified, not estimates.
          </p>
        </div>
      )}

      {/* C: demoted proof-of-model feed, one deduplicated column. */}
      <section className="mt-10">
        <h2 className="type-section mb-1 text-ink">Recent duels, matched to chain</h2>
        <p className="type-micro mb-3 normal-case text-ink-faint">
          Resolved duels from the Gigaverse feed, each matched to its on-chain Duelborn. Proof the model lines up with reality.
        </p>
        <DuelFeed completed={feed.completed as never[]} />
      </section>
    </div>
  );
}
