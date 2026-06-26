"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LiveRacesResponse, LiveRaceItem } from "@/lib/api/types";
import { TRACK_LABEL } from "@/lib/display";

// A lightweight LIVE status tracker for the wallet's in-flight races (joined but not
// yet resolved). NOT a visualization: state is read, not animated. Each row is LIVE
// (glow) with a Gigaverse deep-link while pending, and flips to FINISHED (gold) with a
// Paddock recap link the moment Paddock has it resolved. It polls while the tab is
// visible so the flip happens without a manual refresh, and renders nothing when the
// wallet has no in-flight races (no empty block).
const POLL_MS = 20_000;
const gigaRaceUrl = (raceId: number) => `https://gigaverse.io/racing/race/${raceId}`;

export default function LiveRaces({ wallet }: { wallet: string }) {
  const [data, setData] = useState<LiveRacesResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const aliveRef = useRef(0);

  useEffect(() => {
    if (!wallet) { setData(null); setLoaded(true); return; }
    const gen = ++aliveRef.current;
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/wallet/${wallet}/live-races`, { cache: "no-store" });
        if (gen !== aliveRef.current) return;
        if (res.ok) setData((await res.json()) as LiveRacesResponse);
      } catch {
        /* keep the last good state */
      } finally {
        if (gen === aliveRef.current) setLoaded(true);
      }
    };
    load();
    // Poll only while the tab is visible, so a race flips to FINISHED near-live without
    // a refresh; refetch immediately on focus.
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { aliveRef.current++; clearInterval(poll); window.removeEventListener("focus", onFocus); };
  }, [wallet]);

  const races = data?.races ?? [];
  // No flash before the first load, and no empty block when there is nothing in flight.
  if (!loaded || races.length === 0) return null;

  return (
    <section className="assemble mt-8">
      <header className="mb-3">
        <p className="eyebrow">Live now</p>
        <h2 className="type-section text-ink">Races in progress</h2>
        <p className="type-micro mt-0.5 normal-case text-ink-faint">Your joined races, tracked live until they resolve. Updates automatically.</p>
      </header>
      <div className="overflow-hidden rounded-lg border hairline">
        {races.map((r) => <LiveRaceRow key={r.raceId} r={r} />)}
      </div>
    </section>
  );
}

function LiveRaceRow({ r }: { r: LiveRaceItem }) {
  const live = r.status === "live";
  const color = live ? "var(--glow)" : "var(--gold)";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b hairline px-4 py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5" style={{ borderColor: color }}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "animate-pulse" : ""}`} style={{ background: color }} aria-hidden />
          <span className="type-micro uppercase tracking-wider" style={{ color }}>{live ? "Live" : "Finished"}</span>
        </span>
        <div className="min-w-0">
          <span className="type-data text-ink">Race #{r.raceId}</span>
          <span className="type-micro ml-2 normal-case text-ink-faint">
            {r.petIds.map((id) => `#${id}`).join(", ")}
            {r.trackLength ? ` · ${TRACK_LABEL[r.trackLength] ?? `${r.trackLength}m`}` : ""}
          </span>
        </div>
      </div>
      {live ? (
        <a
          href={gigaRaceUrl(r.raceId)}
          target="_blank"
          rel="noopener noreferrer"
          className="type-micro shrink-0 uppercase tracking-wider transition-paddock hover:text-glow"
          style={{ color: "var(--glow)" }}
        >
          Watch on Gigaverse ↗
        </a>
      ) : (
        <Link
          href={`/race/${r.raceId}`}
          className="type-micro shrink-0 uppercase tracking-wider transition-paddock hover:text-glow"
          style={{ color: "var(--gold)" }}
        >
          View recap
        </Link>
      )}
    </div>
  );
}
