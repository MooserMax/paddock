"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecordRow, RecordMode } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import OwnerLabel from "@/components/OwnerLabel";
import { formatRaceTime, formatInt, timeAgo } from "@/lib/format";

// The records board, same windowed pattern as LeaderboardTable: 25 rows
// initially, expand 25 at a time, instant. The TIME column is the hero. The
// adjusted time leads only when the SELECTED track's adjustment passed the board
// gate AND it actually differs from raw for that row; otherwise the single raw
// time shows, so we never render a redundant "adj == raw" pair or imply an
// adjustment we did not make. Every row shows the condition it was set in, the
// honesty dagrid omits.
const INITIAL = 25;
const STEP = 25;

// Condition pill reuses existing tokens, mapped to intuitive temperature: hot is
// the warm coral accent, cold the cool cyan, average neutral ink. var(--glow) is
// the closest "warm" token in the palette (it doubles as the primary accent);
// flagged in the report.
const TEMP_COLOR: Record<string, string> = {
  hot: "var(--glow)",
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

export default function RecordsTable({ rows, total, mode, adjustmentApplied }: { rows: RecordRow[]; total: number; mode: RecordMode; adjustmentApplied: boolean }) {
  const [visible, setVisible] = useState(Math.min(INITIAL, rows.length));
  const shown = rows.slice(0, visible);
  const capped = rows.length < total;
  const adjustedMode = adjustmentApplied && mode === "adjusted";

  return (
    <div>
      <div className="overflow-hidden rounded-lg border hairline">
        <div className="hidden grid-cols-[2.5rem_1fr_8rem_7rem_6rem_5rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
          <span className="type-micro uppercase text-ink-faint">#</span>
          <span className="type-micro uppercase text-ink-faint">Gigling</span>
          <span className="type-micro uppercase text-ink-faint">Time{adjustedMode ? ", adj of raw" : ""}</span>
          <span className="type-micro uppercase text-ink-faint">Owner</span>
          <span className="type-micro uppercase text-ink-faint">Condition</span>
          <span className="type-micro text-right uppercase text-ink-faint">When</span>
        </div>

        {shown.map((r) => {
          // Show the adj/raw pair only when adjusted differs from raw for this row.
          const showPair = adjustedMode && r.adjustedTimeMs != null && r.adjustedTimeMs !== r.rawTimeMs;
          return (
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
                <span className="mt-0.5 flex items-center gap-2 md:hidden">
                  <ConditionPill temp={r.raceTemp} />
                  <span className="type-micro text-ink-faint">{timeAgo(r.resolvedAt)}</span>
                </span>
              </Link>

              <span className="flex flex-col text-right md:text-left">
                {showPair ? (
                  <>
                    <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>{formatRaceTime(r.adjustedTimeMs)} adj</span>
                    <span className="type-micro tabular-nums text-ink-faint">{formatRaceTime(r.rawTimeMs)} raw</span>
                  </>
                ) : (
                  <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>{formatRaceTime(r.rawTimeMs)}</span>
                )}
              </span>

              {r.ownerAddress ? (
                <OwnerLabel address={r.ownerAddress} name={r.ownerName} title={r.ownerName ?? r.ownerAddress} className="type-data hidden truncate text-ink-faint transition-paddock hover:text-glow md:block" />
              ) : (
                <span className="type-data hidden tabular-nums text-ink-faint md:block">-</span>
              )}

              <span className="hidden md:inline-flex"><ConditionPill temp={r.raceTemp} /></span>

              <Link href={`/race/${r.raceId}`} className="type-micro hidden text-right text-ink-faint transition-paddock hover:text-glow md:block">
                {timeAgo(r.resolvedAt)}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Legend for the novel adj/raw concept, only when an adjustment is shown. */}
      {adjustedMode && (
        <p className="type-micro mt-2 normal-case text-ink-faint">
          adj = adjusted for track temperature, raw = on-chain time. Shown together only where they differ.
        </p>
      )}

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
