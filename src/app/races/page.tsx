import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { RaceListResponse } from "@/lib/api/types";
import { TRACK_LABEL } from "@/lib/display";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Races",
  description: "Recent resolved Gigling races: track, field, winner, and payout. Tap any race for the scanner verdict.",
};

export const revalidate = 30;

const TRACKS = [500, 1200, 2400, 3000];

export default async function RacesPage({ searchParams }: { searchParams: { track?: string } }) {
  const track = searchParams.track && TRACKS.includes(Number(searchParams.track)) ? Number(searchParams.track) : null;
  let feed: RaceListResponse | null = null;
  try {
    feed = await api.races(track, 30, 0, { revalidate: 30 });
  } catch {
    // handled below
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">Live from our database</p>
        <h1 className="type-page-title mt-2 text-ink">Recent races</h1>
        <p className="type-body mt-2 text-ink-soft">Every race that ran, newest first. The Finished column is when the race resolved in-game, not when we synced. Races only resolve once they fill, so gaps between finishes are normal. Tap one for the scanner verdict.</p>
      </header>

      {/* Track filter */}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Filter by track">
        <FilterChip href="/races" active={track === null} label="All tracks" />
        {TRACKS.map((t) => (
          <FilterChip key={t} href={`/races?track=${t}`} active={track === t} label={`${t}m`} />
        ))}
      </nav>

      {!feed || feed.races.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">No races to show</p>
          <p className="type-body mt-1 text-ink-soft">
            {track ? "No resolved races at this distance yet." : "The feed is warming up."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border hairline">
          <div className="hidden grid-cols-[1fr_1.2fr_1.5fr_1fr_0.8fr] gap-4 border-b hairline-strong px-4 py-2.5 md:grid">
            <span className="type-micro uppercase text-ink-faint">Race</span>
            <span className="type-micro uppercase text-ink-faint">Track</span>
            <span className="type-micro uppercase text-ink-faint">Winner</span>
            <span className="type-micro uppercase text-ink-faint">Payout</span>
            <span className="type-micro text-right uppercase text-ink-faint">Finished</span>
          </div>
          {feed.races.map((r) => (
            <Link
              key={r.raceId}
              href={`/race/${r.raceId}`}
              className="transition-paddock grid grid-cols-2 gap-x-4 gap-y-1 border-b hairline px-4 py-3 last:border-0 hover:bg-paper-raised md:grid-cols-[1fr_1.2fr_1.5fr_1fr_0.8fr] md:items-center"
            >
              <span className="type-data text-ink">#{r.raceId}</span>
              <span className="type-data text-ink-soft">{r.trackLength ? TRACK_LABEL[r.trackLength] ?? `${r.trackLength}m` : "unknown"}</span>
              <span className="type-data text-ink-soft">
                {r.winnerName ?? (r.winnerPetId ? `#${r.winnerPetId}` : "unknown")}
              </span>
              <span className="type-data tabular-nums text-ink-faint">
                {r.payoutBps ? r.payoutBps.filter((b) => b > 0).map((b) => `${(b / 100).toFixed(0)}`).join("/") : "-"}
              </span>
              <span className="type-micro text-right text-ink-faint">{timeAgo(r.resolvedAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className="transition-paddock rounded-full border px-3 py-1.5"
      style={active ? { borderColor: "var(--glow)", color: "var(--ink)" } : { borderColor: "var(--line)" }}
    >
      <span className={`type-micro uppercase tracking-wider ${active ? "text-ink" : "text-ink-faint"}`}>{label}</span>
    </Link>
  );
}
