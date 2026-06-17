import type { VerdictDTO } from "@/lib/api/types";

// The verdict, not the data. A single confident call with a one-line headline.
// PASS reads as a stop, ENTERABLE as a go, CAUTION as a yellow light.
const STYLE: Record<VerdictDTO["recommendation"], { color: string; glyph: string; word: string }> = {
  PASS: { color: "var(--brick)", glyph: "✕", word: "Pass" },
  CAUTION: { color: "var(--gold)", glyph: "▲", word: "Caution" },
  ENTERABLE: { color: "var(--green)", glyph: "✓", word: "Enterable" },
};

export default function VerdictBanner({ verdict }: { verdict: VerdictDTO }) {
  const s = STYLE[verdict.recommendation];
  return (
    <div
      className="assemble overflow-hidden rounded-lg border"
      style={{ borderColor: s.color, background: `color-mix(in srgb, ${s.color} 10%, transparent)` }}
    >
      <div className="flex items-start gap-4 p-5 md:p-6">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
          style={{ background: s.color, color: "#14110f" }}
          aria-hidden
        >
          {s.glyph}
        </span>
        <div className="min-w-0">
          <p className="type-micro uppercase tracking-widest" style={{ color: s.color }}>
            {s.word}
          </p>
          <p className="type-section mt-0.5 text-ink">{verdict.headline}</p>
        </div>
      </div>

      {verdict.badges.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t px-5 py-3 md:px-6" style={{ borderColor: "var(--line)" }}>
          {verdict.badges.map((b, i) => (
            <Badge key={i} kind={b.kind} label={b.label} />
          ))}
        </div>
      )}
    </div>
  );
}

const BADGE_COLOR: Record<string, string> = {
  shark: "var(--brick)",
  "payout-trap": "var(--gold)",
  "your-fit": "var(--cyan)",
  "high-elo": "var(--glow)",
  "soft-field": "var(--green)",
  // Fit signals: caution (gold, the same family as the "what cannot be known"
  // note) and a muted secondary, never the red shark style. A heads-up, not a stop.
  "poor-fit": "var(--gold)",
  "off-best-fit": "var(--ink-soft)",
};

function Badge({ kind, label }: { kind: string; label: string }) {
  const color = BADGE_COLOR[kind] ?? "var(--ink-soft)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ borderColor: color }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      <span className="type-micro uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
    </span>
  );
}
