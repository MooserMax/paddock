"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecordRow, RecordMode } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import OwnerLabel from "@/components/OwnerLabel";
import { formatRaceTime, formatInt, timeAgo } from "@/lib/format";

// The records board, same windowed pattern as LeaderboardTable: 25 rows
// initially, expand 25 at a time, instant (rows already in hand). The TIME column
// is the hero; in adjusted mode the adjusted time leads (var(--gold)) with the raw
// time shown muted beside it, so the adjustment is transparent. Every row shows
// the CONDITION the record was set in, the honesty dagrid omits.
const INITIAL = 25;
const STEP = 25;

// Condition pill colors reuse existing tokens (no new colors): hot is the warm
// gold, cold the cool cyan, average the muted ink. Flagged in the report as the
// one element the system had no dedicated token for.
const TEMP_COLOR: Record<string, string> = {
  hot: "var(--gold)",
  cold: "var(--cyan)",
  average: "var(--ink-faint)",
};

function ConditionPill({ temp }: { temp: string }) {
  const color = TEMP_COLOR[temp] ?? "var(--ink-faint)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5" style={{ borderColor: color }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      <span className="type-micro uppercase tracking-wider" style={{ color }}>{temp}</span>
    </span>
  );
}

export default function RecordsTable({ rows, total, mode, adjustedAvailable }: { rows: RecordRow[]; total: number; mode: RecordMode; adjustedAvailable: boolean }) {
  const [visible, setVisible] = useState(Math.min(INITIAL, rows.length));
  const shown = rows.slice(0, visible);
  const capped = rows.length < total;
  const showAdjusted = adjustedAvailable && mode === "adjusted";

  return (
    <div>
      <div className="overflow-hidden rounded-lg border hairline">
        <div className="hidden grid-cols-[2.5rem_1fr_8rem_7rem_6rem_5rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
          <span className="type-micro uppercase text-ink-faint">#</span>
          <span className="type-micro uppercase text-ink-faint">Gigling</span>
          <span className="type-micro uppercase text-ink-faint">Time</span>
          <span className="type-micro uppercase text-ink-faint">Owner</span>
          <span className="type-micro uppercase text-ink-faint">Condition</span>
          <span className="type-micro text-right uppercase text-ink-faint">When</span>
        </div>

        {shown.map((r) => (
          <div
            key={`${r.petId}-${r.raceId}`}
            className="transition-paddock grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b hairline px-4 py-3 last:border-0 hover:bg-paper-raised md:grid-cols-[2.5rem_1fr_8rem_7rem_6rem_5rem]"
          >
            <span className="type-data tabular-nums text-ink-faint">{r.rank}</span>

            <Link href={`/pet/${r.petId}`} className="flex min-w-0 flex-col transition-paddock hover:text-glow">
              <span className="flex min-w-0 items-center gap-2">
                <span className="type-data truncate text-ink">{r.name ?? `#${r.petId}`}</span>
                <RarityBadge rarity={r.rarity} size="sm" />
              </span>
              {/* mobile sub-line: condition + when, which are their own columns on desktop */}
              <span className="mt-0.5 flex items-center gap-2 md:hidden">
                <ConditionPill temp={r.raceTemp} />
                <span className="type-micro text-ink-faint">{timeAgo(r.resolvedAt)}</span>
              </span>
            </Link>

            <span className="flex flex-col text-right md:text-left">
              {showAdjusted && r.adjustedTimeMs != null ? (
                <>
                  <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>{formatRaceTime(r.adjustedTimeMs)} adj</span>
                  <span className="type-micro tabular-nums text-ink-faint">{formatRaceTime(r.rawTimeMs)} raw</span>
                </>
              ) : (
                <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>{formatRaceTime(r.rawTimeMs)}</span>
              )}
            </span>

            {r.ownerAddress ? (
              <OwnerLabel address={r.ownerAddress} name={r.ownerName} className="type-data hidden truncate text-ink-faint transition-paddock hover:text-glow md:block" />
            ) : (
              <span className="type-data hidden tabular-nums text-ink-faint md:block">-</span>
            )}

            <span className="hidden md:inline-flex"><ConditionPill temp={r.raceTemp} /></span>

            <Link href={`/race/${r.raceId}`} className="type-micro hidden text-right text-ink-faint transition-paddock hover:text-glow md:block">
              {timeAgo(r.resolvedAt)}
            </Link>
          </div>
        ))}
      </div>

      {visible < rows.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => Math.min(rows.length, v + STEP))}
          className="transition-paddock mt-3 w-full rounded-lg border hairline py-3 hover:border-line-strong"
        >
          <span className="type-micro uppercase tracking-wider text-ink-faint">Show {Math.min(STEP, rows.length - visible)} more</span>
        </button>
      )}

      <p className="type-micro mt-3 normal-case text-ink-faint">
        Showing {shown.length} of {capped ? `the top ${rows.length}` : rows.length}
        {capped ? `, from ${formatInt(total)} records` : ` records`}.
      </p>
    </div>
  );
}
