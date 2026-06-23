"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MyRaceDTO, RaceTrackingDTO } from "@/lib/api/types";
import { formatEth, formatRaceTime, ordinal } from "@/lib/format";

// Follow-your-entry tracker. Discovers the wallet's most recent race, then follows
// it forming -> running -> result, graded against Paddock's prediction.
//
// REFRESH DESIGN (deliberately client-side, never a server background refresh, the
// bug fixed in c4d4a34): this open component polls the race endpoint on an interval
// and STOPS the moment the race resolves (phase 3) or the component unmounts. One
// race, one client cadence, so it is polite by construction.
const POLL_MS = 4000;

function PhasePill({ phase }: { phase: number }) {
  const map: Record<number, { label: string; color: string }> = {
    1: { label: "Forming", color: "var(--cyan)" },
    2: { label: "Running", color: "var(--glow)" },
    3: { label: "Resolved", color: "var(--green)" },
  };
  const p = map[phase] ?? { label: "Live", color: "var(--ink-faint)" };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5" style={{ borderColor: p.color }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} aria-hidden />
      <span className="type-micro uppercase tracking-wider" style={{ color: p.color }}>{p.label}</span>
    </span>
  );
}

export default function RaceTracker({ wallet }: { wallet: string }) {
  const [target, setTarget] = useState<MyRaceDTO | null>(null);
  const [data, setData] = useState<RaceTrackingDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const stopped = useRef(false);

  // 1. Discover the race once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/my-race?wallet=${wallet}`, { cache: "no-store" });
        const j = res.ok ? ((await res.json()) as MyRaceDTO) : null;
        if (alive) { setTarget(j); setLoaded(true); }
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [wallet]);

  // 2. Poll the tracked race, stopping at phase 3 or on unmount.
  useEffect(() => {
    if (!target?.raceId || !target.petId) return;
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/v1/race-live/${target.raceId}?pet=${target.petId}`, { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as RaceTrackingDTO;
          setData(j);
          if (j.phase >= 3 || j.resolved) { stopped.current = true; return; } // stop polling once resolved
        }
      } catch {
        // transient; the next tick retries
      }
      if (!stopped.current) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stopped.current = true; if (timer) clearTimeout(timer); };
  }, [target?.raceId, target?.petId]);

  if (!loaded) return null;
  if (!target?.raceId || !target.petId) return null; // nothing to follow, surfaced honestly as nothing

  const r = data;
  const yourName = r?.yourName ?? `#${target.petId}`;
  const payoutEth = r?.yourPayoutWei != null ? Number(r.yourPayoutWei) / 1e18 : null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="type-section text-ink">Your live race</h2>
        {r && <PhasePill phase={r.phase} />}
      </div>

      <div className="panel p-4 md:p-5">
        {!r ? (
          <p className="type-body text-ink-soft">Loading race #{target.raceId}.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link href={`/race/${r.raceId}`} className="type-card-title text-ink transition-paddock hover:text-glow">
                Race #{r.raceId}, {r.trackLength}m{r.raceTemp ? `, ${r.raceTemp}` : ""}
              </Link>
              <span className="type-data text-ink-soft">{r.petCount}/{r.fieldSize} in</span>
            </div>

            {/* Pre-race prediction, the Paddock differentiator */}
            {r.band && (
              <p className="type-micro mt-1 normal-case text-ink-faint">
                Paddock predicts {yourName} is a <span style={{ color: "var(--glow)" }}>{r.band.label.toLowerCase()}</span> here, {r.band.range}. Estimate, not a guarantee.
              </p>
            )}

            {/* Lifecycle body */}
            {r.phase < 2 && (
              <p className="type-body mt-3 text-ink-soft">Race forming. Your horse is in; the field is still filling.</p>
            )}
            {r.phase === 2 && (
              <p className="type-body mt-3 text-ink-soft">Race locked and running. Results land here as soon as it finishes, no fake play-by-play, race timing is not exposed mid-race.</p>
            )}

            {r.resolved && (
              <div className="mt-3">
                {/* The grade: prediction vs actual */}
                {r.yourPlacing != null && (
                  <p className="type-body text-ink">
                    {r.band ? `Predicted ${r.band.label.toLowerCase()}, ` : ""}
                    {yourName} finished <span style={{ color: r.yourPlacing === 1 ? "var(--green)" : "var(--ink)" }}>{ordinal(r.yourPlacing)} of {r.fieldSize}</span>
                    {r.yourTimeMs != null ? `, ${formatRaceTime(r.yourTimeMs)}` : ""}
                    {payoutEth != null && payoutEth > 0 ? `, paid ${formatEth(payoutEth, 4)}` : ""}.
                  </p>
                )}

                {/* Full finish order */}
                <ol className="mt-3 space-y-1">
                  {r.entrants.map((e) => (
                    <li key={e.petId} className="flex items-baseline justify-between gap-3">
                      <span className="type-data" style={{ color: e.isYours ? "var(--glow)" : "var(--ink-soft)" }}>
                        {e.finishPosition != null ? `${ordinal(e.finishPosition)}  ` : ""}
                        <Link href={`/pet/${e.petId}`} className="transition-paddock hover:text-glow">{e.name ?? `#${e.petId}`}</Link>
                        {e.isYours ? " (yours)" : ""}
                      </span>
                      <span className="type-micro tabular-nums text-ink-faint">{e.timeMs != null ? formatRaceTime(e.timeMs) : ""}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
