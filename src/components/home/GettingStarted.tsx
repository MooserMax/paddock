import Link from "next/link";

// A compact, scannable getting-started guide under the home wallet bar: one tile per
// feature (mono label + one terse line), each linking to that page, so a visitor
// knows what to DO. Collapsible via native <details> (no client JS), default open,
// kept tight so it does not push the hero far down on desktop. Copy is fixed and
// verified; do not paraphrase.
const ITEMS: { label: string; href: string; desc: string }[] = [
  {
    label: "Develop",
    href: "/develop",
    desc: "Race your unrevealed Giglings. Batch your hidden horses into free races in one signature and farm the stat reveals that turn an unknown into a known quantity. No entry fee.",
  },
  {
    label: "Stable",
    href: "/stable",
    desc: "Read your collection like a scout. Connect your wallet (read-only, no signature) to load a full report on every horse you own: your standouts, their confirmed quality and upside, and which to develop next.",
  },
  {
    label: "Race Finder",
    href: "/race-finder",
    desc: "Find the races where you have the edge. Live open lobbies scored by the odds model and ranked to surface where your horse is favored, then enter in a click.",
  },
  {
    label: "Scanner",
    href: "/scanner",
    desc: "Should you enter? Paste a race (a past result or a live lobby) and the scanner returns a calibrated verdict on whether your horse fits, honest about the one thing it cannot see.",
  },
  {
    label: "Records",
    href: "/records",
    desc: "The fastest Giglings in Gigaverse. All-time track records by distance, raw and condition-adjusted, from real on-chain finishes.",
  },
];

export default function GettingStarted() {
  return (
    <details className="assemble mt-6 max-w-4xl" style={{ animationDelay: "140ms" }} open>
      <summary className="type-micro cursor-pointer list-none uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">
        New here? What you can do
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((it) => (
          <Link key={it.href} href={it.href} className="panel block p-3 transition-paddock hover:border-glow">
            <span className="type-micro uppercase tracking-wider" style={{ color: "var(--glow)" }}>{it.label}</span>
            <p className="type-micro mt-1 normal-case text-ink-faint">{it.desc}</p>
          </Link>
        ))}
      </div>
    </details>
  );
}
