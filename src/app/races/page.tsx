import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { RaceListResponse } from "@/lib/api/types";
import { TRACK_LABEL } from "@/lib/display";
import { timeAgo, ordinal } from "@/lib/format";
import MyRacesFilter from "@/components/races/MyRacesFilter";

export const metadata: Metadata = {
  title: "Races",
  description: "Recent resolved Gigling races: track, field, winner, and payout. Tap any race for the scanner verdict.",
};

export const revalidate = 30;

const TRACKS = [500, 1200, 2400, 3000];

export default async function RacesPage(props: { searchParams: Promise<{ track?: string; wallet?: string }> }) {
  const searchParams = await props.searchParams;
  const track = searchParams.track && TRACKS.includes(Number(searchParams.track)) ? Number(searchParams.track) : null;
  const wallet = searchParams.wallet && /^0x[0-9a-fA-F]{40}$/.test(searchParams.wallet) ? searchParams.wallet.toLowerCase() : null;
  let feed: RaceListResponse | null = null;
  try {
    feed = await api.races(track, 30, 0, wallet, { revalidate: 30 });
  } catch {
    // handled below
  }

  // Preserve the wallet filter when switching tracks, so "My races + 1200m" composes.
  const walletQ = wallet ? `wallet=${wallet}` : "";
  const trackHref = (t: number | null) => {
    const parts = [t ? `track=${t}` : "", walletQ].filter(Boolean);
    return `/races${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">Live from our database</p>
        <h1 className="type-page-title mt-2 text-ink">Recent races</h1>
        <p className="type-body mt-2 text-ink-soft">Every race that ran, newest first. The Finished column is when the race resolved in-game, not when we synced. Races only resolve once they fill, so gaps between finishes are normal. Tap one for the scanner verdict.</p>
      </header>

      {/* Track + participant filter */}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Filter races">
        <FilterChip href={trackHref(null)} active={track === null} label="All tracks" />
        {TRACKS.map((t) => (
          <FilterChip key={t} href={trackHref(t)} active={track === t} label={`${t}m`} />
        ))}
        <MyRacesFilter track={track} activeWallet={wallet} />
      </nav>

      {!feed || feed.races.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">{wallet ? "No races for this wallet yet" : "No races to show"}</p>
          <p className="type-body mt-1 text-ink-soft">
            {wallet
              ? (track ? "This wallet has not entered a race at this distance yet." : "No races found for this wallet yet. Once one of your horses runs, it shows here.")
              : (track ? "No resolved races at this distance yet." : "The feed is warming up.")}
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
              <span className="type-data text-ink">
                #{r.raceId}
                {r.mine && r.mine.length > 0 && (
                  <span className="type-micro ml-2 normal-case" style={{ color: "var(--glow)" }}>
                    you: {r.mine.map((m) => `${m.name ?? `#${m.petId}`}${m.finishPosition ? ` ${ordinal(m.finishPosition)}` : ""}`).join(", ")}
                  </span>
                )}
              </span>
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
