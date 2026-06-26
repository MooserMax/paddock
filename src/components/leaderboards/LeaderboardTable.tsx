"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { LeaderboardMetric, LeaderboardRow } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import OwnerLabel from "@/components/OwnerLabel";
import { formatEth, formatPct, formatScore } from "@/lib/format";

// Client-side column sort over the already-loaded rows (no refetch). The server
// 'rank' is the rank for the SELECTED METRIC tab and is NEVER renumbered by a column
// sort: rows reorder, but each row keeps its true metric rank, and a note says so.
type SortKey = "value" | "elo" | "win" | "races" | "reveal" | "upside";
const SORT_GET: Record<SortKey, (r: LeaderboardRow) => number> = {
  value: (r) => r.value,
  elo: (r) => r.elo ?? -Infinity,
  win: (r) => r.shrunkWinRate,
  races: (r) => r.racesRun,
  reveal: (r) => r.revealPct ?? -Infinity,
  upside: (r) => r.upsideRaw ?? -Infinity,
};

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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const isUpside = metric === "upside";
  const label = metric === "cq" ? "Confirmed quality" : metric === "elo" ? "ELO" : metric === "winrate" ? "Win rate" : metric === "earnings" ? "Earnings" : "Upside";
  const capped = rows.length < total;

  // Switching metric tabs resets any custom sort to the new metric's default order.
  useEffect(() => { setSortKey(null); setSortDir("desc"); setVisible(Math.min(INITIAL, rows.length)); }, [metric, rows.length]);

  function onSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  const sorted = sortKey
    ? [...rows].sort((a, b) => { const av = SORT_GET[sortKey](a), bv = SORT_GET[sortKey](b); return sortDir === "desc" ? bv - av : av - bv; })
    : rows;
  const shown = sorted.slice(0, visible);
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none");
  const SORT_LABELS: Record<SortKey, string> = { value: label, elo: "ELO", win: "Win rate", races: "Races", reveal: "Reveal", upside: "Upside" };

  return (
    <div>
      {sortKey && (
        <p className="type-micro mb-2 normal-case text-ink-faint" aria-live="polite">
          Sorted by {SORT_LABELS[sortKey]}, {sortDir === "asc" ? "ascending" : "descending"}. The # column stays the {label} rank, not this order.{" "}
          <button type="button" onClick={() => setSortKey(null)} className="underline transition-paddock hover:text-glow">Clear sort</button>
        </p>
      )}
      <div className="overflow-hidden rounded-lg border hairline">
        {isUpside ? (
          <div role="row" className="hidden grid-cols-[2.5rem_1fr_6rem_5rem_5rem_8rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
            <span className="type-micro uppercase text-ink-faint">#</span>
            <span className="type-micro uppercase text-ink-faint">Gigling</span>
            <SortHeader label="Reveal-adj" k="value" active={sortKey === "value"} dir={sortDir} onSort={onSort} arrow={arrow("value")} align="right" />
            <SortHeader label="Reveal" k="reveal" active={sortKey === "reveal"} dir={sortDir} onSort={onSort} arrow={arrow("reveal")} align="right" />
            <SortHeader label="Upside" k="upside" active={sortKey === "upside"} dir={sortDir} onSort={onSort} arrow={arrow("upside")} align="right" />
            <span className="type-micro uppercase text-ink-faint">Owner</span>
          </div>
        ) : (
          <div role="row" className="hidden grid-cols-[2.5rem_1fr_7rem_8rem_5rem_7rem_6rem] gap-3 border-b hairline-strong px-4 py-2.5 md:grid">
            <span className="type-micro uppercase text-ink-faint">#</span>
            <span className="type-micro uppercase text-ink-faint">Gigling</span>
            <SortHeader label={label} k="value" active={sortKey === "value"} dir={sortDir} onSort={onSort} arrow={arrow("value")} />
            <span className="type-micro uppercase text-ink-faint">Owner</span>
            <SortHeader label="ELO" k="elo" active={sortKey === "elo"} dir={sortDir} onSort={onSort} arrow={arrow("elo")} align="right" />
            <SortHeader label="Win (raw)" k="win" active={sortKey === "win"} dir={sortDir} onSort={onSort} arrow={arrow("win")} align="right" />
            <SortHeader label="Races" k="races" active={sortKey === "races"} dir={sortDir} onSort={onSort} arrow={arrow("races")} align="right" />
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

// A click-to-sort column header: a real button with aria-sort, an active arrow, and
// a faint idle indicator so it reads as sortable. Mono micro-label style, like the
// other headers and the Records filters.
function SortHeader({ label, k, active, dir, onSort, arrow, align }: { label: string; k: SortKey; active: boolean; dir: "asc" | "desc"; onSort: (k: SortKey) => void; arrow: "ascending" | "descending" | "none"; align?: "right" }) {
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={arrow}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
      onClick={() => onSort(k)}
      className={`type-micro inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider transition-paddock hover:text-ink ${align === "right" ? "justify-end text-right" : ""}`}
      style={{ color: active ? "var(--glow)" : "var(--ink-faint)" }}
    >
      {label}
      <span aria-hidden style={{ opacity: active ? 1 : 0.35, fontSize: "0.85em" }}>{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
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
