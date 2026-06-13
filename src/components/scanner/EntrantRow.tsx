import Link from "next/link";
import type { RaceEntrantDTO } from "@/lib/api/types";
import { tierStars } from "@/lib/display";
import { formatPct } from "@/lib/format";

// One entrant, read as a threat assessment: shrunk win rate with the raw record
// beside it (never just the flattering number), ELO, and revealed traits.
export default function EntrantRow({ entrant, marked }: { entrant: RaceEntrantDTO; marked?: boolean }) {
  const tag = entrant.isShark ? "shark" : entrant.highElo ? "high-elo" : null;
  const tagColor = entrant.isShark ? "var(--brick)" : "var(--glow)";

  return (
    <div
      className="flex items-center gap-3 border-b hairline py-3 last:border-0"
      style={marked ? { background: "color-mix(in srgb, var(--cyan) 8%, transparent)" } : undefined}
    >
      <div className="w-6 text-center">
        {entrant.finishPosition ? (
          <span className="type-data tabular-nums" style={{ color: entrant.finishPosition === 1 ? "var(--gold)" : "var(--ink-faint)" }}>
            {entrant.finishPosition}
          </span>
        ) : (
          <span className="type-micro text-ink-faint">-</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/pet/${entrant.petId}`} className="type-data text-ink transition-paddock hover:text-glow">
            {entrant.name ?? `#${entrant.petId}`}
          </Link>
          {marked && <span className="type-micro uppercase" style={{ color: "var(--cyan)" }}>your horse</span>}
          {tag && (
            <span className="type-micro uppercase tracking-wider" style={{ color: tagColor }}>
              {tag === "shark" ? "shark" : "in form"}
            </span>
          )}
        </div>
        {entrant.revealedTraits.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-3">
            {entrant.revealedTraits.map((t) => (
              <span key={t.id} className="type-micro normal-case text-ink-faint">
                {t.name} <span style={{ color: "var(--gold)" }}>{tierStars(t.tier)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        <div className="type-data tabular-nums text-ink">
          {formatPct(entrant.shrunkWinRate)}
          <span className="text-ink-faint"> shrunk</span>
        </div>
        <div className="type-micro text-ink-faint">
          {entrant.racesRun ? `${entrant.wins}/${entrant.racesRun} raw` : "no races"}
          {entrant.elo != null ? ` · elo ${Math.round(entrant.elo)}` : ""}
        </div>
      </div>
    </div>
  );
}
