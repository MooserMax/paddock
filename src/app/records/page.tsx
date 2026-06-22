import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { RecordsResponse, RecordMode, RecordWindow } from "@/lib/api/types";
import RecordsTable from "@/components/records/RecordsTable";
import RarityBadge from "@/components/RarityBadge";
import { formatRaceTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "Racing records",
  description: "The fastest finishes in Gigling Racing, by distance, corrected for track conditions where the data supports it. On-chain times from resolved races, no login required.",
};

export const revalidate = 30;

const MODES: { key: RecordMode; label: string }[] = [
  { key: "adjusted", label: "True speed (adjusted)" },
  { key: "raw", label: "Raw time" },
];
const WINDOWS: { key: RecordWindow; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "weekly", label: "This week" },
  { key: "daily", label: "Today" },
];
const CANONICAL = [500, 1200, 2400, 3000]; // lead with the named distances

function Chip({ href, active, label, dim }: { href: string; active: boolean; label: string; dim?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className="transition-paddock rounded-full border px-3 py-1.5"
      style={active ? { borderColor: "var(--glow)", color: "var(--ink)" } : { borderColor: "var(--line)" }}
    >
      <span className={`type-micro uppercase tracking-wider ${active ? "text-ink" : dim ? "text-ink-faint opacity-70" : "text-ink-faint"}`}>{label}</span>
    </Link>
  );
}

interface SP { track?: string; mode?: string; window?: string; all?: string }

export default async function RecordsPage({ searchParams }: { searchParams: SP }) {
  const reqTrack = searchParams.track ? Number(searchParams.track) : null;
  const reqMode = (MODES.find((m) => m.key === searchParams.mode)?.key ?? "adjusted") as RecordMode;
  const reqWindow = (WINDOWS.find((w) => w.key === searchParams.window)?.key ?? "all") as RecordWindow;
  const showAllTracks = searchParams.all === "1";

  let board: RecordsResponse | null = null;
  try {
    board = await api.records(reqTrack, reqMode, reqWindow, 100, 0, { revalidate: 30 });
  } catch {
    // empty state below
  }

  const track = board?.track ?? reqTrack ?? 0;
  // Exclude a 0/unknown track length; it must never render as "0m".
  const tracks = (board?.tracks ?? []).filter((t) => t > 0);
  const adjustedSet = new Set(board?.adjustedTracks ?? []);
  const mode: RecordMode = board && !board.adjustmentApplied ? "raw" : reqMode;
  const win = reqWindow;
  const qs = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    p.set("track", String(over.track ?? track));
    p.set("mode", String(over.mode ?? mode));
    p.set("window", String(over.window ?? win));
    if (showAllTracks || over.all) p.set("all", "1");
    return `/records?${p.toString()}`;
  };

  // Lead with the canonical distances (in order) then the other adjusted/populated
  // tracks; the sparse long tail hides behind a "More distances" disclosure.
  const primary = [...CANONICAL.filter((t) => tracks.includes(t)), ...tracks.filter((t) => !CANONICAL.includes(t) && adjustedSet.has(t)).sort((a, b) => a - b)];
  const longTail = tracks.filter((t) => !primary.includes(t)).sort((a, b) => a - b);
  const chipTracks = showAllTracks ? [...primary, ...longTail] : primary;

  const f = board?.fastest;

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">On-chain finish times, resolved races</p>
        <h1 className="type-page-title mt-2 text-balance text-ink">Racing records</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          {board?.meta.explanation ??
            "Fastest finishes from every resolved race. Hot tracks run faster, so raw times are not directly comparable; adjusted times correct for that where the data supports it."}
        </p>
      </header>

      {/* Hero: the single fastest finish in the game */}
      {f && (
        <Link href={`/pet/${f.petId}`} className="assemble mb-6 block rounded-lg border p-5 transition-paddock hover:border-line-strong" style={{ borderColor: "var(--glow)", background: "color-mix(in srgb, var(--glow) 8%, transparent)" }}>
          <p className="type-micro uppercase tracking-widest" style={{ color: "var(--glow)" }}>The fastest Gigling in Gigaverse</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="type-page-title tabular-nums text-ink">{formatRaceTime(f.timeMs)}</span>
            <span className="type-data text-ink-soft">{f.name ?? `#${f.petId}`}</span>
            <RarityBadge rarity={f.rarity} size="sm" />
          </div>
          <p className="type-micro mt-1 normal-case text-ink-faint">
            {f.adjusted ? "adjusted" : "raw"}, fastest finish at {f.track}m, set in {f.raceTemp} conditions{f.ownerName ? `, owned by ${f.ownerName}` : ""}.
          </p>
        </Link>
      )}

      {/* Track filter */}
      {chipTracks.length > 0 && (
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter by track">
          {chipTracks.map((t) => (
            <Chip key={t} href={qs({ track: String(t) })} active={t === track} label={`${t}m`} dim={!adjustedSet.has(t)} />
          ))}
          {!showAllTracks && longTail.length > 0 && (
            <Link href={qs({ all: "1" })} className="transition-paddock rounded-full border px-3 py-1.5" style={{ borderColor: "var(--line)" }}>
              <span className="type-micro uppercase tracking-wider text-ink-faint">More distances ({longTail.length})</span>
            </Link>
          )}
        </nav>
      )}

      {/* Mode toggle (only when some track is adjusted) + window toggle */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {board?.adjustedAvailable &&
          MODES.map((m) => <Chip key={m.key} href={qs({ mode: m.key })} active={m.key === mode} label={m.label} />)}
        <span className="mx-1 hidden h-4 w-px sm:inline-block" style={{ background: "var(--line)" }} aria-hidden />
        {WINDOWS.map((w) => (
          <Chip key={w.key} href={qs({ window: w.key })} active={w.key === win} label={w.label} />
        ))}
      </div>

      {/* Honest per-track note when in adjusted mode on a track that did not pass the gate */}
      {board && board.adjustedAvailable && !board.adjustmentApplied && board.rows.length > 0 && (
        <p className="mb-4 type-micro normal-case text-ink-faint">
          Not enough races at {track}m to adjust for conditions yet, showing raw times.
        </p>
      )}

      {!board || board.rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">No records yet</p>
          <p className="type-body mt-1 text-ink-soft">
            {board && tracks.length > 0 ? "No qualifying records at this distance and window." : "The records board is still computing. Check back shortly."}
          </p>
        </div>
      ) : (
        <RecordsTable rows={board.rows} total={board.total} mode={mode} adjustmentApplied={board.adjustmentApplied} />
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">
        On-chain finish times from resolved races, the condition each was set in always shown. Reference condition {board?.referenceCondition ?? "average"}, recomputed each run. The public{" "}
        <Link href="/api/v1/records" className="underline transition-paddock hover:text-glow">/api/v1/records</Link>
        {" "}endpoint is the programmatic export of this data.
      </p>
    </div>
  );
}
