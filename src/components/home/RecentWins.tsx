"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RecentWinsResponse, RecentWin } from "@/lib/api/types";
import { formatEth, formatUsd, ownerDisplay, timeAgo } from "@/lib/format";

// Live recent-wins feed in the homepage flagship slot. Money moving, not another
// horse showcase, so it complements the leaderboard below rather than duplicating
// it. Borderless to match the homepage's lighter treatment (hairline dividers, no
// boxed cards), with the payout in coral as the focal point of each row.
//
// Refresh: client-side polling on a bounded cadence that STOPS on unmount, the same
// discipline as the race tracker; no server-side background refresh. Seeded with
// server data so it never flashes empty.
const POLL_MS = 20000;

function secondsAgo(iso: string | null): string {
  if (!iso) return "just now";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 2 ? "just now" : `${s}s ago`;
}

export default function RecentWins({ initial }: { initial: RecentWinsResponse }) {
  const [data, setData] = useState<RecentWinsResponse>(initial);
  const [, setTick] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped.current) return;
      try {
        const res = await fetch("/api/v1/recent-wins", { cache: "no-store" });
        if (res.ok && !stopped.current) setData((await res.json()) as RecentWinsResponse);
      } catch {
        // transient; the next poll retries
      }
      if (!stopped.current) poll = setTimeout(tick, POLL_MS);
    };
    poll = setTimeout(tick, POLL_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { stopped.current = true; if (poll) clearTimeout(poll); clearInterval(clock); };
  }, []);

  const wins = data.wins;

  return (
    <section className="mx-auto max-w-page px-4 py-12 md:px-6">
      {/* Heading left, muted mono live indicator right, mirroring the other sections. */}
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="type-section text-ink">Recent wins</h2>
        <span className="type-micro inline-flex items-center gap-1.5 uppercase tracking-wider text-ink-faint">
          <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse-soft" style={{ background: "var(--glow)" }} aria-hidden />
          Live, updated {secondsAgo(data.fetchedAt)}
        </span>
      </div>

      {wins.length === 0 ? (
        <p className="type-body text-ink-soft">No paid-race wins to show yet. Money moves through here as paid races resolve.</p>
      ) : (
        <div>
          {wins.map((w) => <WinRow key={`${w.raceId}-${w.petId}`} win={w} />)}
        </div>
      )}
    </section>
  );
}

function WinRow({ win: w }: { win: RecentWin }) {
  const winner = w.petName ?? `Gigling #${w.petId}`;
  const owner = w.ownerAddress ? ownerDisplay(w.ownerName, w.ownerAddress) : "unknown";
  const sub = [
    `${owner} won`,
    w.trackLength != null ? `${w.trackLength}m` : null,
    w.fieldSize != null ? `${w.fieldSize} field` : null,
  ].filter(Boolean).join(", ");
  return (
    <Link
      href={`/race/${w.raceId}`}
      className="transition-paddock flex items-center justify-between gap-4 border-b py-3.5 hairline last:border-0 hover:opacity-80"
    >
      <div className="min-w-0">
        <p className="type-card-title truncate text-ink">{winner}</p>
        <p className="type-body truncate text-ink-soft">{sub}</p>
        <p className="type-micro mt-0.5 normal-case text-ink-faint">{timeAgo(w.resolvedAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="type-section tabular-nums" style={{ color: "var(--glow)" }}>
          {w.payoutUsd != null ? formatUsd(w.payoutUsd) : formatEth(w.payoutEth, 4)}
        </p>
        <p className="type-data tabular-nums text-ink-faint">{formatEth(w.payoutEth, 4)}</p>
      </div>
    </Link>
  );
}
