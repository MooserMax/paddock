"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { RaceListResponse } from "@/lib/api/types";
import { TRACK_LABEL } from "@/lib/display";
import { timeAgo, ordinal } from "@/lib/format";

// The Recent races list, made live: it re-fetches the SAME /api/v1/races view (the
// endpoint is already uncached and fresh, so this is a plain client re-fetch, not a
// cache-bust) on a manual Refresh, on a gentle visible-tab interval, and on focus. The
// server passes the first page of data so there is no load flash. A freshness stamp
// shows how current the list is. Track + wallet come from props (URL-driven), so every
// refetch respects the active track filter and the My races toggle.
const AUTO_REFRESH_MS = 45_000;
const CLICK_DEBOUNCE_MS = 1_500;

export default function RacesList({ initialFeed, track, wallet }: { initialFeed: RaceListResponse | null; track: number | null; wallet: string | null }) {
  const [feed, setFeed] = useState<RaceListResponse | null>(initialFeed);
  const [fetchedAt, setFetchedAt] = useState<number>(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0); // re-render so the relative stamp stays current
  const aliveRef = useRef(0);
  const lastClickRef = useRef(0);

  const query = `limit=30&offset=0${track ? `&track=${track}` : ""}${wallet ? `&wallet=${wallet}` : ""}`;

  const refresh = useCallback(async (manual: boolean) => {
    if (manual) {
      const now = Date.now();
      if (now - lastClickRef.current < CLICK_DEBOUNCE_MS) return;
      lastClickRef.current = now;
    }
    const gen = ++aliveRef.current;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/v1/races?${query}`, { cache: "no-store" });
      if (gen !== aliveRef.current) return;
      if (res.ok) { setFeed((await res.json()) as RaceListResponse); setFetchedAt(Date.now()); }
    } catch {
      /* keep the current view on a failed refresh */
    } finally {
      if (gen === aliveRef.current) setRefreshing(false);
    }
  }, [query]);

  // Gentle auto-refresh while the tab is visible, plus a refetch on focus; a slow ticker
  // keeps the "Updated ... ago" stamp honest between fetches. All paused work is cleaned
  // up on unmount (the page remounts this with a new key when the filters change).
  useEffect(() => {
    const poll = setInterval(() => { if (document.visibilityState === "visible") refresh(false); }, AUTO_REFRESH_MS);
    const tick = setInterval(() => setTick((n) => n + 1), 15_000);
    const onFocus = () => refresh(false);
    window.addEventListener("focus", onFocus);
    return () => { aliveRef.current++; clearInterval(poll); clearInterval(tick); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const races = feed?.races ?? [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="type-micro normal-case text-ink-faint" aria-live="polite">Updated {timeAgo(new Date(fetchedAt).toISOString())}</span>
        <button
          type="button"
          onClick={() => refresh(true)}
          disabled={refreshing}
          aria-busy={refreshing}
          className="type-micro inline-flex items-center gap-1 uppercase tracking-wider transition-paddock hover:text-glow disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: "var(--glow)" }}
        >
          <span aria-hidden className={refreshing ? "inline-block animate-spin" : "inline-block"}>{"↻"}</span>
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {races.length === 0 ? (
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
          {races.map((r) => (
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
