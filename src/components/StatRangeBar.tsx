import { STAT_FLOOR, STAT_CEIL, FRESH_RANGE_WIDTH } from "@/lib/scoring/constants";

interface StatRangeBarProps {
  label: string;
  min: number | null;
  max: number | null;
  // Number of reveals recorded for this stat, shown as supporting context.
  reveals?: number | null;
  accent?: string;
}

function pos(value: number): number {
  const clamped = Math.min(STAT_CEIL, Math.max(STAT_FLOOR, value));
  return ((clamped - STAT_FLOOR) / (STAT_CEIL - STAT_FLOOR)) * 100;
}

// The signature Paddock visual. A stat is never shown as a fabricated point
// value. We draw the true revealed range as a band on a 50-to-100 track; the
// narrower the band, the more is known. A reveal-progress meter and an explicit
// "revealed / unrevealed" label make the known-vs-unknown distinction instant.
export default function StatRangeBar({
  label,
  min,
  max,
  reveals,
  accent = "var(--glow)",
}: StatRangeBarProps) {
  const known = min !== null && max !== null;
  const width = known ? Math.max(0, max - min) : FRESH_RANGE_WIDTH;
  const revealFrac = Math.min(1, Math.max(0, (FRESH_RANGE_WIDTH - width) / FRESH_RANGE_WIDTH));
  const left = known ? pos(min) : 0;
  const right = known ? pos(max) : 100;
  const bandWidth = Math.max(1.5, right - left);
  // A tight, well-revealed band reads as near-certain; a wide one reads faint.
  const bandOpacity = 0.35 + 0.55 * revealFrac;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label text-[0.7rem] uppercase tracking-wider text-ink-soft">
          {label}
        </span>
        <span className="mono tnum text-[0.7rem] text-ink-faint">
          {known ? (
            revealFrac >= 0.999 ? (
              <span className="text-ink">{Math.round((min + max) / 2)}</span>
            ) : (
              <>
                {min} <span className="text-ink-faint">to</span> {max}
              </>
            )
          ) : (
            "unrevealed"
          )}
        </span>
      </div>

      <div
        className="relative h-2.5 rounded-full"
        style={{ background: "var(--paper-sunken)", border: "1px solid var(--line)" }}
        role="img"
        aria-label={
          known
            ? `${label} between ${min} and ${max}, ${Math.round(revealFrac * 100)}% revealed`
            : `${label} unrevealed`
        }
      >
        {/* tick at the population-typical midpoint (75) for reference */}
        <div
          className="absolute top-1/2 h-3 w-px -translate-y-1/2"
          style={{ left: "50%", background: "var(--line-strong)" }}
        />
        <div
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full"
          style={{
            left: `${left}%`,
            width: `${bandWidth}%`,
            background: accent,
            opacity: bandOpacity,
            boxShadow: revealFrac > 0.6 ? `0 0 8px ${accent}` : "none",
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="mono text-[0.62rem] text-ink-faint">
          {Math.round(revealFrac * 100)}% revealed
          {typeof reveals === "number" ? ` · ${reveals} reveal${reveals === 1 ? "" : "s"}` : ""}
        </span>
        <span className="mono text-[0.62rem] text-ink-faint">50 to 100</span>
      </div>
    </div>
  );
}
