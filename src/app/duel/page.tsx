import type { Metadata } from "next";
import { getDuelGlobalStats } from "@/lib/api/queries";
import { fetchDuelListings, fetchDuelConfig } from "@/lib/duel";
import { formatInt, formatEth } from "@/lib/format";
import DuelFeed from "@/components/duel/DuelFeed";
import DuelRadar from "@/components/duel/DuelRadar";
import BreedingPreview from "@/components/duel/BreedingPreview";

export const metadata: Metadata = {
  title: "Duel",
  description: "Gigling breeding via combat: the live duel feed, your stable's duel eligibility and fatal-final-duel radar, and a deterministic breeding preview. Read-only intelligence, every input from Paddock's own race data.",
};

export const revalidate = 30;

export default async function DuelPage() {
  const [stats, config, preparing, completed] = await Promise.all([
    getDuelGlobalStats(),
    fetchDuelConfig(),
    fetchDuelListings({ status: "preparing", limit: 20 }),
    fetchDuelListings({ status: "completed", limit: 20 }),
  ]);

  const tiles = stats
    ? [
        { v: formatInt(stats.duelsResolved), l: "Duels resolved" },
        { v: formatInt(stats.duelbornMinted), l: "Duelborn minted" },
        { v: formatInt(stats.listingsCreated), l: "Listings created" },
        { v: `${formatEth(Number(stats.challengeFeesWei) / 1e18, 3)}`, l: "Challenge fees", accent: true },
      ]
    : [];

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow" style={{ color: "var(--brick)" }}>Breeding via combat</p>
        <h1 className="type-page-title mt-2 text-ink">Duel</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          Every duel pairs one male and one female Gigling; one falls and becomes the Duelborn. Paddock reads it all from its own race data: who is eligible, who is on a fatal final duel, and what a pairing certainly produces. Read-only, the duel itself happens in Gigaverse.
        </p>
      </header>

      {stats && (
        <div className="mb-8 overflow-hidden rounded-xl border hairline" style={{ background: "var(--paper-raised)" }}>
          <div className="grid grid-cols-2 gap-px md:grid-cols-4" style={{ background: "var(--line)" }}>
            {tiles.map((t, i) => (
              <div key={i} className="px-5 py-5" style={{ background: "var(--paper-raised)" }}>
                <p className="font-serif text-2xl leading-none tabular-nums md:text-3xl" style={{ color: t.accent ? "var(--gold)" : "var(--ink)" }}>{t.v}{t.accent ? " ETH" : ""}</p>
                <p className="type-micro mt-2 uppercase tracking-wider text-ink-faint">{t.l}</p>
              </div>
            ))}
          </div>
          <p className="type-micro px-5 py-3 normal-case text-ink-faint" style={{ borderTop: "1px solid var(--line)" }}>
            Measured on-chain from PetDuelingSystem events. Current duels are free (0 ETH challenge fee). The breeding odds model (rarity %, stat ranges, trait star-tiers) is in progress; everything below it is verified mechanics, not estimates.
          </p>
        </div>
      )}

      <section className="mb-10">
        <h2 className="type-section mb-3 text-ink">Live duel feed</h2>
        <DuelFeed preparing={preparing.listings as never[]} completed={completed.listings as never[]} />
      </section>

      <section className="mb-10">
        <h2 className="type-section mb-1 text-ink">Eligibility radar</h2>
        <p className="type-micro mb-3 normal-case text-ink-faint">
          Paste any wallet. From our indexed race data: who is duel-eligible (40+ races, by gender), who is approaching, and who is on a fatal final duel.
        </p>
        <DuelRadar minRaces={config?.minRacesToDuel ?? 40} />
      </section>

      <section>
        <h2 className="type-section mb-1 text-ink">Breeding preview</h2>
        <p className="type-micro mb-3 normal-case text-ink-faint">
          Two Gigling ids. Certain outcomes (generation + its boost, gender rule), known-odds (faction, expected stats), and what is pending the odds model, clearly separated.
        </p>
        <BreedingPreview />
      </section>
    </div>
  );
}
