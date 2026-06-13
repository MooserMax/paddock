import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api, ApiClientError } from "@/lib/api/client";
import type { RaceDetail, OddsResponse } from "@/lib/api/types";
import ScannerVerdict from "@/components/scanner/ScannerVerdict";
import Panel from "@/components/ui/Panel";
import { formatPct } from "@/lib/format";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  return { title: `Race #${params.id}`, description: `Scanner verdict and odds for Gigling race #${params.id}.` };
}

export default async function RacePage({ params, searchParams }: { params: { id: string }; searchParams: { mark?: string } }) {
  const mark = searchParams.mark ? Number(searchParams.mark) : undefined;
  let race: RaceDetail | null = null;
  try {
    race = await api.race(params.id, mark, { revalidate: 60 });
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) notFound();
    throw err;
  }
  if (!race) notFound();

  let odds: OddsResponse | null = null;
  try {
    odds = await api.odds(params.id, { revalidate: 120 });
  } catch {
    // odds are supplementary; the verdict still stands without them
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="assemble mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">Scanner verdict</p>
          <h1 className="type-page-title text-ink">Race #{race.raceId}</h1>
        </div>
        <Link href="/scanner" className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">
          Scan another race
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <ScannerVerdict race={race} markedPetId={mark} />

        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          {odds && (
            <Panel eyebrow={`Model ${odds.modelVersion}`} title="Win probability" note="Uncalibrated estimates until the backtest publishes.">
              <div className="space-y-2.5">
                {odds.entrants.map((e) => (
                  <div key={e.petId} className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <Link href={`/pet/${e.petId}`} className="type-data text-ink transition-paddock hover:text-glow">
                        {e.name ?? `#${e.petId}`}
                      </Link>
                      <span className="type-data tabular-nums text-ink-soft">{formatPct(e.winProbability, 1)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--paper-sunken)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, e.winProbability * 100)}%`, background: "var(--cyan)" }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <p className="type-micro normal-case text-ink-faint">
            Served by{" "}
            <Link href={`/api/v1/race/${race.raceId}`} className="underline transition-paddock hover:text-glow">
              /api/v1/race/{race.raceId}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
