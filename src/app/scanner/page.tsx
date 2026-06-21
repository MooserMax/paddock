import Link from "next/link";
import type { Metadata } from "next";
import { api, ApiClientError } from "@/lib/api/client";
import type { RaceDetail, PetDossier, OddsResponse } from "@/lib/api/types";
import ScannerControls from "@/components/scanner/ScannerControls";
import ScannerVerdict from "@/components/scanner/ScannerVerdict";
import SingleHorseRead from "@/components/scanner/SingleHorseRead";

export const metadata: Metadata = {
  title: "Scanner",
  description: "Paste a race or a live lobby and get a verdict: sharks, payout traps, and whether your horse fits the track.",
};

export const revalidate = 30;

interface SP {
  race?: string;
  pets?: string;
  track?: string;
  mark?: string;
}

export default async function ScannerPage({ searchParams }: { searchParams: SP }) {
  const mark = searchParams.mark ? Number(searchParams.mark) : undefined;
  const track = Number(searchParams.track ?? 1200);
  let result: RaceDetail | null = null;
  let single: PetDossier | null = null;
  let odds: OddsResponse | null = null;
  let error: string | null = null;
  let scanned = false;

  if (searchParams.race) {
    scanned = true;
    try {
      result = await api.race(searchParams.race, mark, { revalidate: 60 });
      // A resolved race shows its result and a self-grade; fetch the pre-race
      // odds so the grade can name our favorite and its predicted probability.
      if (result?.resolved) {
        odds = await api.odds(searchParams.race, { revalidate: 120 }).catch(() => null);
      }
    } catch (err) {
      error = err instanceof ApiClientError ? err.message : "Could not read that race.";
    }
  } else if (searchParams.pets) {
    scanned = true;
    const ids = searchParams.pets.split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 1) {
      // One horse: a single-horse read rather than a dead-end.
      try {
        single = await api.pet(ids[0]);
      } catch (err) {
        error = err instanceof ApiClientError ? err.message : "Could not read that Gigling.";
      }
    } else if (ids.length >= 2) {
      try {
        result = await api.scan(ids, track, mark);
      } catch (err) {
        error = err instanceof ApiClientError ? err.message : "Could not scan that lobby.";
      }
    } else {
      error = "Add at least one Gigling id. The scanner grades a field, so paste the lobby as it fills.";
    }
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6 max-w-2xl">
        <p className="eyebrow">The verdict engine</p>
        <h1 className="type-page-title mt-2 text-ink">Should you enter?</h1>
        <p className="type-body mt-3 text-ink-soft">
          The scanner does not show you data, it gives you a call. Read a race we have, or paste a live lobby and mark your horse to check its fit. It is honest about the one thing it cannot see.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-start">
        <div className="lg:sticky lg:top-20">
          <ScannerControls defaultMode={searchParams.pets ? "lobby" : "race"} />
        </div>

        <div>
          {!scanned && (
            <div className="panel flex min-h-[260px] flex-col items-center justify-center p-8 text-center">
              <span className="asterisk text-3xl">✳</span>
              <p className="type-card-title mt-3 text-ink">No field loaded</p>
              <p className="type-body mt-1 max-w-sm text-ink-soft">
                Load the example to watch the model get it wrong: a 99.9% favorite that finished third, graded against what actually happened.
              </p>
              <Link href="/scanner?race=5648" className="type-micro mt-4 inline-block uppercase tracking-wider transition-paddock hover:text-glow" style={{ color: "var(--glow)" }}>
                Load the miss
              </Link>
            </div>
          )}

          {scanned && error && (
            <div className="panel p-6">
              <p className="type-card-title text-ink">That did not scan</p>
              <p className="type-body mt-1 text-ink-soft">{error}</p>
              <p className="type-body mt-2 text-ink-soft">
                If this race has not run yet, it will not be in our database. Grade it with the upcoming-race option above by pasting the lobby&apos;s Giglings instead.
              </p>
              <Link href="/scanner?race=5648" className="type-micro mt-4 inline-block uppercase tracking-wider transition-paddock hover:text-glow" style={{ color: "var(--glow)" }}>
                Or load the example race
              </Link>
            </div>
          )}

          {result && <ScannerVerdict race={result} markedPetId={mark} odds={odds} />}
          {single && <SingleHorseRead pet={single} track={track} />}
        </div>
      </div>
    </div>
  );
}
