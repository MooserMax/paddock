import Link from "next/link";
import type { FounderRow } from "@/lib/api/types";
import { rarityDisplay } from "@/lib/display";

// Surface 2, Placement B: a compact top-5 Bloodline Founders card on /duel. Credibility + discovery,
// links to the full Intel board. Not the primary action, so it sits below the recommender/feed.
export default function FoundersPanel({ rows }: { rows: FounderRow[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-section text-ink">Bloodline founders</h2>
        <Link href="/founders" className="type-micro uppercase tracking-wider transition-paddock hover:text-glow" style={{ color: "var(--gold)" }}>Full board -&gt;</Link>
      </div>
      <p className="type-micro mb-3 normal-case text-ink-faint">Genesis Giglings seeding dynasties, ranked by direct Duelborn.</p>
      <div className="overflow-hidden rounded-lg border hairline">
        {rows.slice(0, 5).map((f, i) => (
          <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b hairline px-4 py-2.5 last:border-0">
            <span className="type-data w-5 tabular-nums text-ink-faint">{i + 1}</span>
            <span className="type-data flex-1 truncate">
              <Link href={`/pet/${f.id}`} className="text-ink transition-paddock hover:text-glow">{f.name ?? `#${f.id}`}</Link>{" "}
              <span style={{ color: rarityDisplay(f.rarity.value).color }}>{f.rarity.name}</span>
              {f.topTrait ? <span className="text-ink-faint"> · {f.topTrait}</span> : ""}
            </span>
            <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>{f.directOffspring} Duelborn</span>
            <span className="type-data w-32 text-right tabular-nums text-ink-soft">{f.climb.total > 0 ? `${f.climb.observed}/${f.climb.total} climbed` : "no climbs"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
