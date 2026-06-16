import Link from "next/link";
import { api } from "@/lib/api/client";
import { NAV_ROUTES } from "@/lib/nav";
import { timeAgo } from "@/lib/format";

// Footer links derive from the route registry (ready routes only, never a dead
// link). The freshness line states when the data was last synced so a live dot
// is never shown over a frozen number.
export default async function Footer() {
  let petsSyncedAt: string | null = null;
  let racesScannedAt: string | null = null;
  try {
    const stats = await api.stats();
    petsSyncedAt = stats.petsSyncedAt;
    racesScannedAt = stats.racesScannedAt;
  } catch {
    // freshness line simply omits if stats are unavailable
  }

  const footerLinks = NAV_ROUTES.filter((r) => r.ready && (r.href === "/methodology" || r.href === "/docs"));

  return (
    <footer className="mt-24 border-t hairline">
      <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-10 md:flex-row md:items-end md:justify-between md:px-6">
        <div className="space-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="asterisk text-lg leading-none">✳</span>
            <span className="type-card-title">Paddock</span>
          </div>
          <p className="type-micro max-w-xs uppercase leading-relaxed text-ink-faint">
            The open intelligence layer for Gigling Racing. One verified engine, never a fabricated number.
          </p>
          {(petsSyncedAt || racesScannedAt) && (
            <p className="type-micro text-ink-faint">
              Synced {timeAgo(racesScannedAt ?? petsSyncedAt)}
              {petsSyncedAt && racesScannedAt ? ` · pets ${timeAgo(petsSyncedAt)}` : ""}
            </p>
          )}
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
          {footerLinks.map((l) => (
            <Link key={l.href} href={l.href} className="transition-paddock type-micro uppercase tracking-wider text-ink-faint hover:text-ink">
              {l.label === "API" ? "API" : l.label}
            </Link>
          ))}
          <span className="type-micro uppercase tracking-wider text-ink-faint">a Patch Notes product</span>
        </nav>
      </div>
    </footer>
  );
}
