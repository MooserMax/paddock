import Link from "next/link";

// The shared tab bar for the leaderboards family. The five pet metrics live on
// /leaderboards as query params; the stable board is its own route. Both pages
// render this so they read as one family. The exact chip style matches the
// original inline tabs (rounded border, glow when active).
const TABS: { key: string; label: string; href: string }[] = [
  { key: "cq", label: "Confirmed quality", href: "/leaderboards?metric=cq" },
  { key: "elo", label: "ELO", href: "/leaderboards?metric=elo" },
  { key: "winrate", label: "Win rate", href: "/leaderboards?metric=winrate" },
  { key: "earnings", label: "Earnings", href: "/leaderboards?metric=earnings" },
  { key: "upside", label: "Upside", href: "/leaderboards?metric=upside" },
  { key: "spenders", label: "Top spenders", href: "/leaderboards?metric=spenders" },
  { key: "stable", label: "Stable skill", href: "/stables" },
];

export default function LeaderboardTabs({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Leaderboard board">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "true" : undefined}
            className="transition-paddock rounded-full border px-3.5 py-1.5"
            style={on ? { borderColor: "var(--glow)" } : { borderColor: "var(--line)" }}
          >
            <span className={`type-micro uppercase tracking-wider ${on ? "text-ink" : "text-ink-faint"}`}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
