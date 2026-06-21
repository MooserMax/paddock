"use client";

import { useState } from "react";
import type { StableRow } from "@/lib/api/types";
import OwnerLabel from "@/components/OwnerLabel";
import { formatPercentile, formatScore, formatInt } from "@/lib/format";

// The stable board, same windowed pattern as the pet leaderboards: 25 rows
// initially, expand 25 at a time, instant (rows already in hand). Percentile is
// the hero; the score is secondary; proven and total are the independent depth
// signal, shown but never folded into the score.
const INITIAL = 25;
const STEP = 25;

export default function StableLeaderboardTable({ rows, total }: { rows: StableRow[]; total: number }) {
  const [visible, setVisible] = useState(Math.min(INITIAL, rows.length));
  const shown = rows.slice(0, visible);
  const capped = rows.length < total;

  return (
    <div>
      <div className="overflow-hidden rounded-lg border hairline">
        <div className="hidden grid-cols-[2.5rem_1fr_7rem_5rem_9rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
          <span className="type-micro uppercase text-ink-faint">#</span>
          <span className="type-micro uppercase text-ink-faint">Stable</span>
          <span className="type-micro uppercase text-ink-faint">Percentile</span>
          <span className="type-micro text-right uppercase text-ink-faint">Score</span>
          <span className="type-micro text-right uppercase text-ink-faint">Proven · total</span>
        </div>

        {shown.map((r) => (
          <div
            key={r.ownerAddress}
            className="transition-paddock grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b hairline px-4 py-3 last:border-0 hover:bg-paper-raised md:grid-cols-[2.5rem_1fr_7rem_5rem_9rem]"
          >
            <span className="type-data tabular-nums text-ink-faint">{r.rank}</span>
            <OwnerLabel
              address={r.ownerAddress}
              name={r.ownerName}
              className="type-data min-w-0 truncate text-ink transition-paddock hover:text-glow"
            />
            <span className="type-data tabular-nums" style={{ color: "var(--glow)" }}>{formatPercentile(r.percentile)}</span>
            <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">{formatScore(r.score)}</span>
            <span className="type-data text-right tabular-nums text-ink-faint">
              {formatInt(r.provenCount)}<span className="text-ink-faint"> · {formatInt(r.totalHorses)}</span>
            </span>
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
        {capped ? `, from ${formatInt(total)} ranked stables` : ` ranked stables`}.
      </p>
    </div>
  );
}
