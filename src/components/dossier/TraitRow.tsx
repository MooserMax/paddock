import type { TraitDTO } from "@/lib/api/types";
import { tierStars } from "@/lib/display";

// A trait line: name, revealed star level or "?", the plain-language effect, and
// the study-measured lift inline. Surger reads positive, Volatile negative; an
// unrevealed star level is honestly a "?", never guessed.
export default function TraitRow({ trait }: { trait: TraitDTO }) {
  const revealed = trait.tier !== null;
  const lift = trait.globalLift;
  const liftPositive = lift !== null && lift > 1;
  const liftNegative = lift !== null && lift < 1;

  return (
    <div className="flex items-start justify-between gap-4 border-b hairline py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="type-data text-ink">{trait.name}</span>
          <span
            className="type-micro"
            style={{ color: revealed ? "var(--gold)" : "var(--ink-faint)" }}
            aria-label={revealed ? `${trait.tier} star` : "star level not revealed"}
            title={revealed ? `Revealed ${trait.tier}-star` : "Star level reveals at a milestone race"}
          >
            {tierStars(trait.tier)}
          </span>
        </div>
        <p className="type-micro mt-1 max-w-sm normal-case leading-relaxed text-ink-faint">{trait.blurb}</p>
      </div>
      {lift !== null && (
        <div className="shrink-0 text-right">
          <div
            className="type-data tabular-nums"
            style={{ color: liftPositive ? "var(--green)" : liftNegative ? "var(--glow)" : "var(--ink-soft)" }}
          >
            {lift.toFixed(2)}x
          </div>
          <div className="type-micro uppercase text-ink-faint">study lift</div>
        </div>
      )}
    </div>
  );
}
