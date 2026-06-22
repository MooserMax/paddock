import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { RecordsResponse, RecordMode, RecordWindow } from "@/lib/api/types";
import RecordsTable from "@/components/records/RecordsTable";

export const metadata: Metadata = {
  title: "Racing records",
  description: "The fastest finishes in Gigling Racing, by distance, adjusted for track conditions and validated out of sample. On-chain times from resolved races, no login required.",
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

// The shared chip look from the races feed: rounded-full border, glow when active.
function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className="transition-paddock rounded-full border px-3 py-1.5"
      style={active ? { borderColor: "var(--glow)", color: "var(--ink)" } : { borderColor: "var(--line)" }}
    >
      <span className={`type-micro uppercase tracking-wider ${active ? "text-ink" : "text-ink-faint"}`}>{label}</span>
    </Link>
  );
}

interface SP { track?: string; mode?: string; window?: string }

export default async function RecordsPage({ searchParams }: { searchParams: SP }) {
  const reqTrack = searchParams.track ? Number(searchParams.track) : null;
  const reqMode = (MODES.find((m) => m.key === searchParams.mode)?.key ?? "adjusted") as RecordMode;
  const reqWindow = (WINDOWS.find((w) => w.key === searchParams.window)?.key ?? "all") as RecordWindow;

  let board: RecordsResponse | null = null;
  try {
    board = await api.records(reqTrack, reqMode, reqWindow, 100, 0, { revalidate: 30 });
  } catch {
    // empty state below
  }

  const track = board?.track ?? reqTrack ?? 0;
  const tracks = board?.tracks ?? [];
  const mode: RecordMode = board && !board.adjustedAvailable ? "raw" : reqMode;
  const win = reqWindow;
  const qs = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    p.set("track", String(over.track ?? track));
    p.set("mode", String(over.mode ?? mode));
    p.set("window", String(over.window ?? win));
    return `/records?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow">On-chain finish times, resolved races</p>
        <h1 className="type-page-title mt-2 text-balance text-ink">Racing records</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          {board?.meta.explanation ??
            "Fastest finishes from every resolved race, adjusted for track conditions. Hot tracks run faster, so raw times are not directly comparable."}
        </p>
      </header>

      {/* Track filter */}
      {tracks.length > 0 && (
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter by track">
          {tracks.map((t) => (
            <Chip key={t} href={qs({ track: String(t) })} active={t === track} label={`${t}m`} />
          ))}
        </nav>
      )}

      {/* Mode toggle (only when the adjustment validated) + window toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {board?.adjustedAvailable &&
          MODES.map((m) => <Chip key={m.key} href={qs({ mode: m.key })} active={m.key === mode} label={m.label} />)}
        <span className="mx-1 hidden h-4 w-px sm:inline-block" style={{ background: "var(--line)" }} aria-hidden />
        {WINDOWS.map((w) => (
          <Chip key={w.key} href={qs({ window: w.key })} active={w.key === win} label={w.label} />
        ))}
      </div>

      {!board || board.rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">No records yet</p>
          <p className="type-body mt-1 text-ink-soft">
            {board && tracks.length > 0 ? "No qualifying records at this distance and window." : "The records board is still computing. Check back shortly."}
          </p>
        </div>
      ) : (
        <RecordsTable rows={board.rows} total={board.total} mode={mode} adjustedAvailable={board.adjustedAvailable} />
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">
        On-chain finish times from resolved races, condition each record was set in always shown. Reference condition {board?.referenceCondition ?? "average"}, recomputed each run. Served by{" "}
        <Link href="/api/v1/records" className="underline transition-paddock hover:text-glow">/api/v1/records</Link>.
      </p>
    </div>
  );
}
