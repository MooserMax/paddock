import Link from "next/link";

// Part 4: "Breeding, the short course." Collapsed by default (<details>, no JS needed). Content is
// grounded in the official Info tabs and Paddock's live data; the {braced} values are computed live
// and passed in, never hardcoded. Editorial style: Crimson Pro heading, mono micro-labels.
const GIGA_DUEL_URL = "https://gigaverse.io/duel";

export default function BreedingExplainer({ climbs, n, openCount, minFee }: { climbs: number; n: number; openCount: number; minFee: string }) {
  const items: { h: string; body: React.ReactNode }[] = [
    { h: "The loop", body: <>Race a Gigling to 40, duel it, race the Duelborn. Every generation adds +5 Start, Speed, and Finish, stacking past the normal cap. A gen-2 with the same rolled stats as a gen-1 is simply faster. Generation is the engine; everything else tunes it.</> },
    { h: "Pick the Fallen on purpose", body: <>In a Closed Duel you mark who falls. The Fallen sets the Duelborn&apos;s gender with certainty and its body is gone for good, but rarity centers on the lower parent either way. So sacrifice the weaker racer and keep the proven one; you lose nothing in the odds.</> },
    { h: "Rarity is a bloodline project, not a lottery", body: <>Same-tier pairs hold their tier about 94% of the time. Pairing across a gap climbs more often (Legendary x Giga reaches Relic or Giga about 15% of the time, versus under 2% for Legendary x Legendary), but a wide gap cannot jump to the top in one duel. Giga x Giga is the one certainty: always a Giga. Observed so far here: {climbs} climbs in {n} duels.</> },
    { h: "Stats are a midpoint bet with insurance", body: <>Each stat bell-curves around the parents&apos; midpoint; close parents breed predictable, far-apart parents are a spread bet at the same average. Rarity sets a floor no stat can roll under, so a high-rarity Duelborn from modest parents still starts solid. Chasing rarity is also buying stat insurance.</> },
    { h: "Line-breed your best trait", body: <>Traits both parents carry are far more likely to be inherited, and tier follows the parents: two 3-stars pass a 3-star 59% of the time; a 1-star and a 3-star only 34%. If both parents carry Surger, the strongest trait in the game, you are stacking the deck. Mutations draw from the newest generation&apos;s frontier, so climbing generations is also how a line reaches traits nobody else has yet.</> },
    { h: "Females are structurally scarce", body: <>The Duelborn always copies the Fallen&apos;s gender, so breeding never changes the male-to-female balance; only genesis mints can. Whichever gender is scarcer stays scarcer forever. Hold and value accordingly.</> },
    { h: "Faction is bought in points", body: <>A natural parent stakes 35 of 100 toward its faction, a converted one 15, Faction Dust adds 5 per influence; the unclaimed rest rolls factionless. Two natural same-faction parents hit 70%; add two Dust and it is 80%. Gigus is the exception: the only Gigus Duelborn comes from a Gigus parent falling, and then it is certain.</> },
    { h: "The final duel is a tool, and glue is the exit", body: <>A Gigling&apos;s last duel is always fatal, so plan it: point it at the pairing where its fall is the plan, or reglue it (up to 3 times) to keep it racing. The glue math favors the strong: degluing one junk Rare (8 glue) more than covers regluing a Legendary (6). Render the horses you will never race; keep the ones you will.</> },
    { h: "Hosting pays, challenging builds", body: <>Host a Challenger&apos;s Duel at high Host Favour and you likely bank the fee and keep your Gigling; the challenger always takes the Duelborn, win or lose. Right now: <Link href={GIGA_DUEL_URL} target="_blank" rel="noopener noreferrer" className="transition-paddock underline hover:text-glow" style={{ color: "var(--gold)" }}>{openCount} open challenges</Link>, fees from {minFee} ETH.</> },
  ];

  return (
    <details className="mt-10 overflow-hidden rounded-xl border hairline" style={{ background: "var(--paper-raised)" }}>
      <summary className="cursor-pointer list-none px-5 py-4 md:px-6">
        <span className="type-section text-ink">Breeding, the short course</span>
        <span className="type-micro ml-2 uppercase tracking-wider text-ink-faint">expand</span>
      </summary>
      <div className="border-t hairline px-5 py-5 md:px-6">
        <ol className="space-y-5">
          {items.map((it, i) => (
            <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-3">
              <span className="font-mono text-sm tabular-nums" style={{ color: "var(--gold)" }}>{i + 1}</span>
              <div>
                <p className="font-serif text-lg text-ink">{it.h}</p>
                <p className="type-body mt-0.5 text-ink-soft">{it.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
