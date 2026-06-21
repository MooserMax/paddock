"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TRACKS = [500, 1200, 2400, 3000];

// The scanner's two input modes. Both navigate by URL so the verdict is rendered
// server-side from /api/v1, and a scan is shareable as a link.
export default function ScannerControls({ defaultMode = "race" }: { defaultMode?: "race" | "lobby" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"race" | "lobby">(defaultMode);
  const [raceId, setRaceId] = useState("");
  const [pets, setPets] = useState("");
  const [track, setTrack] = useState(1200);
  const [mark, setMark] = useState("");
  const [error, setError] = useState<string | null>(null);

  function scanRace(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(raceId.trim());
    if (!Number.isInteger(id) || id <= 0) return setError("Enter a race id, a positive number.");
    router.push(`/scanner?race=${id}`);
  }

  function scanLobby(e: React.FormEvent) {
    e.preventDefault();
    const ids = pets.split(/[\s,]+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    // One id gives a single-horse read; two or more grades the field. Zero is the
    // only error here.
    if (ids.length < 1) return setError("Paste at least one Gigling id, separated by spaces or commas.");
    const m = mark.trim() ? Number(mark.trim()) : null;
    if (m && !ids.includes(m)) return setError("Your horse must be one of the pasted ids.");
    router.push(`/scanner?pets=${ids.join(",")}&track=${track}${m ? `&mark=${m}` : ""}`);
  }

  return (
    <div className="panel p-5 md:p-6">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="What are you scanning">
        {([
          { m: "race", title: "A past race", hint: "look up a resolved race's verdict" },
          { m: "lobby", title: "An upcoming race", hint: "grade a lobby before you enter, paste the Giglings" },
        ] as const).map(({ m, title, hint }) => {
          const active = mode === m;
          return (
            <button
              key={m}
              role="tab"
              aria-selected={active}
              onClick={() => { setMode(m); setError(null); }}
              className="transition-paddock rounded-md border p-3 text-left"
              style={{ borderColor: active ? "var(--glow)" : "var(--line)", background: active ? "var(--paper-sunken)" : "transparent" }}
            >
              <span className={`type-data block ${active ? "text-ink" : "text-ink-soft"}`}>{title}</span>
              <span className="type-micro mt-0.5 block normal-case text-ink-faint">{hint}</span>
            </button>
          );
        })}
      </div>
      <p className="type-micro mb-4 normal-case text-ink-faint">
        Have a race id from a race that already ran? Use a past race. Deciding whether to enter one that has not run yet? Use an upcoming race and paste its Giglings.
      </p>

      {mode === "race" ? (
        <form onSubmit={scanRace} className="space-y-3">
          <label className="type-micro block uppercase text-ink-faint" htmlFor="race-id">Race id</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="race-id"
              value={raceId}
              onChange={(e) => { setRaceId(e.target.value); setError(null); }}
              inputMode="numeric"
              placeholder="e.g. 5667"
              className="type-data flex-1 rounded-md border bg-transparent px-3 py-2.5 text-ink outline-none transition-paddock focus-visible:border-glow"
              style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
            />
            <button type="submit" className="type-data rounded-md px-5 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
              Read the verdict
            </button>
          </div>
          <p className="type-micro pt-1 normal-case text-ink-faint">
            Calibrated, not clairvoyant: two real races, one the model missed and one it nailed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Example label="A call that missed" onClick={() => router.push("/scanner?race=5648")} />
            <Example label="A call that landed" onClick={() => router.push("/scanner?race=5667")} />
          </div>
        </form>
      ) : (
        <form onSubmit={scanLobby} className="space-y-3">
          <label className="type-micro block uppercase text-ink-faint" htmlFor="lobby-pets">Gigling ids in the lobby</label>
          <textarea
            id="lobby-pets"
            value={pets}
            onChange={(e) => { setPets(e.target.value); setError(null); }}
            rows={2}
            placeholder="Paste ids, e.g. 6249 3010 1971 442"
            className="type-data w-full rounded-md border bg-transparent px-3 py-2.5 text-ink outline-none transition-paddock focus-visible:border-glow"
            style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="type-micro block uppercase text-ink-faint" htmlFor="lobby-track">Track</label>
              <select
                id="lobby-track"
                value={track}
                onChange={(e) => setTrack(Number(e.target.value))}
                className="type-data mt-1 w-full rounded-md border bg-transparent px-3 py-2.5 text-ink outline-none transition-paddock focus-visible:border-glow"
                style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
              >
                {TRACKS.map((t) => <option key={t} value={t}>{t}m</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="type-micro block uppercase text-ink-faint" htmlFor="lobby-mark">Your horse (optional)</label>
              <input
                id="lobby-mark"
                value={mark}
                onChange={(e) => setMark(e.target.value)}
                inputMode="numeric"
                placeholder="id to check fit"
                className="type-data mt-1 w-full rounded-md border bg-transparent px-3 py-2.5 text-ink outline-none transition-paddock focus-visible:border-glow"
                style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
              />
            </div>
            <button type="submit" className="type-data rounded-md px-5 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
              Scan the lobby
            </button>
          </div>
          <div className="pt-1">
            <Example label="Example lobby: 6249 3010 1971 442 (mark 6249)" onClick={() => router.push("/scanner?pets=6249,3010,1971,442&track=1200&mark=6249")} />
          </div>
        </form>
      )}

      {error && <p className="type-micro mt-3 normal-case" style={{ color: "var(--glow)" }} role="alert">{error}</p>}
    </div>
  );
}

function Example({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="transition-paddock rounded-md border hairline px-3 py-1.5 text-ink-soft hover:text-ink hover:border-line-strong">
      <span className="type-micro normal-case">{label}</span>
    </button>
  );
}
