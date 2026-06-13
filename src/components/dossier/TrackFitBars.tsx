import type { TrackFitDTO } from "@/lib/api/types";
import { TRACK_LABEL } from "@/lib/display";

const DISTANCES = [500, 1200, 2400, 3000] as const;

// Per-distance fit bars. The best distance is the headline; the bars extend the
// StatRangeBar's visual logic so fit reads at a glance, not as a generic chart.
export default function TrackFitBars({ fit, best }: { fit: TrackFitDTO; best: number }) {
  return (
    <div className="space-y-3">
      {DISTANCES.map((d) => {
        const value = fit[String(d) as keyof TrackFitDTO];
        const isBest = d === best;
        return (
          <div key={d} className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className={`type-micro uppercase tracking-wider ${isBest ? "text-ink" : "text-ink-faint"}`}>
                {TRACK_LABEL[d]}
                {isBest && <span className="ml-2 normal-case" style={{ color: "var(--glow)" }}>best fit</span>}
              </span>
              <span className="type-data tabular-nums text-ink-soft">{value.toFixed(0)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--paper-sunken)" }}>
              <div
                className="h-full rounded-full transition-paddock"
                style={{
                  width: `${Math.max(2, Math.min(100, value))}%`,
                  background: isBest ? "var(--glow)" : "var(--cyan)",
                  opacity: isBest ? 1 : 0.55,
                  boxShadow: isBest ? "0 0 8px var(--glow)" : "none",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
