"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeaderboardMetric, LeaderboardRow } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import OwnerLabel from "@/components/OwnerLabel";
import { formatEth, formatPct, formatScore } from "@/lib/format";

// Up to 100 rows are reachable per board, but we never paint 100 at once (that
// wall is heavy on mobile and was a likely render-timeout cause). Render 25, then
// expand on demand. State is client-side; the rows are already in hand, so "show
// more" is instant with no refetch.
const INITIAL = 25;
const STEP = 25;

function primaryValue(metric: LeaderboardMetric, r: LeaderboardRow): string {
  if (metric === "cq") return formatScore(r.value);
  if (metric === "elo") return String(Math.round(r.value));
  if (metric === "winrate") return formatPct(r.value);
  if (metric === "earnings") return formatEth(r.value, 4);
  return `+${formatScore(r.value)}`; // upside: reveal-adjusted, above the reveal baseline
}

export default function LeaderboardTable({ rows, metric, total }: { rows: LeaderboardRow[]; metric: LeaderboardMetric; total: number }) {
  const [visible, setVisible] = useState(Math.min(INITIAL, rows.length));
  const shown = rows.slice(0, visible);
  const isUpside = metric === "upside";
  const label = metric === "cq" ? "Confirmed quality" : metric === "elo" ? "ELO" : metric === "winrate" ? "Win rate" : metric === "earnings" ? "Earnings" : "Upside";
  const capped = rows.length < total;

  return (
    <div>
      <div className="overflow-hidden rounded-lg border hairline">
        {isUpside ? (
          <div className="hidden grid-cols-[2.5rem_1fr_6rem_5rem_5rem_8rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
            <span className="type-micro uppercase text-ink-faint">#</span>
            <span className="type-micro uppercase text-ink-faint">Gigling</span>
            <span className="type-micro text-right uppercase text-ink-faint">Reveal-adj</span>
            <span className="type-micro text-right uppercase text-ink-faint">Reveal</span>
            <span className="type-micro text-right uppercase text-ink-faint">Upside</span>
            <span className="type-micro uppercase text-ink-faint">Owner</span>
          </div>
        ) : (
          <div className="hidden grid-cols-[2.5rem_1fr_7rem_8rem_5rem_7rem_6rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
            <span className="type-micro uppercase text-ink-faint">#</span>
            <span className="type-micro uppercase text-ink-faint">Gigling</span>
            <span className="type-micro uppercase text-ink-faint">{label}</span>
            <span className="type-micro uppercase text-ink-faint">Owner</span>
            <span className="type-micro text-right uppercase text-ink-faint">ELO</span>
            <span className="type-micro text-right uppercase text-ink-faint">Win (raw)</span>
            <span className="type-micro text-right uppercase text-ink-faint">Races</span>
          </div>
        )}

        {shown.map((r) => (isUpside ? <UpsideRow key={r.petId} r={r} /> : <StandardRow key={r.petId} r={r} metric={metric} />))}
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
        {capped ? `, from ${total.toLocaleString("en-US")} eligible` : ""}.
      </p>
    </div>
  );
}

function RowShell({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <div className={`transition-paddock grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b hairline px-4 py-3 last:border-0 hover:bg-paper-raised ${cols}`}>
      {children}
    </div>
  );
}

function GiglingCell({ r, sub }: { r: LeaderboardRow; sub?: string }) {
  return (
    <Link href={`/pet/${r.petId}`} className="flex min-w-0 flex-col transition-paddock hover:text-glow">
      <span className="flex min-w-0 items-center gap-2">
        <span className="type-data truncate text-ink">{r.name ?? `#${r.petId}`}</span>
        <RarityBadge rarity={r.rarity.value} size="sm" />
      </span>
      {sub && <span className="type-micro normal-case text-ink-faint md:hidden">{sub}</span>}
    </Link>
  );
}

function OwnerCell({ r }: { r: LeaderboardRow }) {
  return r.ownerAddress ? (
    <OwnerLabel address={r.ownerAddress} name={r.ownerName} className="type-data hidden truncate text-ink-faint transition-paddock hover:text-glow md:block" />
  ) : (
    <span className="type-data hidden tabular-nums text-ink-faint md:block">-</span>
  );
}

function StandardRow({ r, metric }: { r: LeaderboardRow; metric: LeaderboardMetric }) {
  return (
    <RowShell cols="md:grid-cols-[2.5rem_1fr_7rem_8rem_5rem_7rem_6rem]">
      <span className="type-data tabular-nums text-ink-faint">{r.rank}</span>
      <GiglingCell r={r} />
      <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>{primaryValue(metric, r)}</span>
      <OwnerCell r={r} />
      <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">{r.elo ?? "-"}</span>
      <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">
        {formatPct(r.shrunkWinRate)}
        <span className="text-ink-faint"> ({r.rawWinRate != null ? formatPct(r.rawWinRate) : "-"})</span>
      </span>
      <span className="type-data hidden text-right tabular-nums text-ink-faint md:block">{r.racesRun}</span>
    </RowShell>
  );
}

function UpsideRow({ r }: { r: LeaderboardRow }) {
  const reveal = r.revealPct != null ? formatPct(r.revealPct) : "-";
  const upside = r.upsideRaw != null ? formatScore(r.upsideRaw) : "-";
  return (
    <RowShell cols="md:grid-cols-[2.5rem_1fr_6rem_5rem_5rem_8rem]">
      <span className="type-data tabular-nums text-ink-faint">{r.rank}</span>
      <GiglingCell r={r} sub={`${reveal} revealed`} />
      <span className="text-right">
        <span className="type-data tabular-nums" style={{ color: "var(--gold)" }}>+{formatScore(r.value)}</span>
        <span className="type-micro block normal-case text-ink-faint md:hidden">upside {upside}</span>
      </span>
      <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">{reveal}</span>
      <span className="type-data hidden text-right tabular-nums text-ink-soft md:block">{upside}</span>
      <OwnerCell r={r} />
    </RowShell>
  );
}
