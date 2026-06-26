import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { RaceListResponse } from "@/lib/api/types";
import MyRacesFilter from "@/components/races/MyRacesFilter";
import RacesList from "@/components/races/RacesList";
import ConnectedLiveRaces from "@/components/races/ConnectedLiveRaces";

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

      {/* In-flight races for the connected wallet, the natural place to look after
          entering. Renders nothing when there are none. */}
      <ConnectedLiveRaces />

      {/* Track + participant filter */}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Filter races">
        <FilterChip href={trackHref(null)} active={track === null} label="All tracks" />
        {TRACKS.map((t) => (
          <FilterChip key={t} href={trackHref(t)} active={track === t} label={`${t}m`} />
        ))}
        <MyRacesFilter track={track} activeWallet={wallet} />
      </nav>

      {/* The list re-fetches in place (manual + gentle auto-refresh), keyed so it resets
          when the track/wallet filter changes. */}
      <RacesList key={`${track ?? "all"}-${wallet ?? "none"}`} initialFeed={feed} track={track} wallet={wallet} />
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
