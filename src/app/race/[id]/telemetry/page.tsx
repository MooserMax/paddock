import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchRaceTelemetry, TelemetryUnavailable } from "@/lib/telemetry";
import { api } from "@/lib/api/client";
import RaceTelemetry from "@/components/telemetry/RaceTelemetry";

export const revalidate = 86400; // resolved telemetry is immutable

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Race #${id} telemetry`, description: `Side-scroll race telemetry for Gigling race #${id}, rendered from real per-tick data: position, speed, and what Paddock's model expected vs what happened.` };
}

export default async function TelemetryPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ pet?: string }> }) {
  const { id } = await props.params;
  const { pet } = await props.searchParams;
  const raceId = Number(id);
  if (!Number.isInteger(raceId) || raceId <= 0) notFound();

  let data;
  try {
    data = await fetchRaceTelemetry(raceId);
  } catch (e) {
    if (e instanceof TelemetryUnavailable) {
      return (
        <div className="mx-auto max-w-page px-4 py-16 md:px-6">
          <p className="eyebrow" style={{ color: "var(--cyan)" }}>Race telemetry</p>
          <h1 className="type-page-title mt-2 text-ink">Race #{raceId}</h1>
          <p className="type-body mt-3 max-w-xl text-ink-soft">{e.message}</p>
          <Link href={`/race/${raceId}`} className="type-micro mt-6 inline-block uppercase tracking-wider transition-paddock hover:text-glow" style={{ color: "var(--glow)" }}>Back to the race</Link>
        </div>
      );
    }
    throw e;
  }

  // Paddock's predicted finishing order from the real odds model (win probability desc).
  // If odds are unavailable we omit MODEL EXPECTED rather than invent a number.
  const modelRankByPet = new Map<number, number>();
  try {
    const odds = await api.odds(raceId);
    [...odds.entrants].sort((a, b) => b.winProbability - a.winProbability).forEach((e, i) => modelRankByPet.set(e.petId, i + 1));
  } catch {
    /* model rank simply omitted */
  }

  // Hero: an explicit ?pet= (the user's runner) wins; otherwise spotlight the runner that
  // most beat its model prediction (the best Paddock story), falling back to the winner.
  const petParam = pet ? Number(pet) : null;
  let heroId: number;
  if (petParam && data.pets.some((p) => p.id === petParam)) {
    heroId = petParam;
  } else {
    let best: number | null = null, bestDelta = -Infinity;
    for (const p of data.pets) {
      const mr = modelRankByPet.get(p.id);
      if (mr != null && mr - p.finalRank > bestDelta) { bestDelta = mr - p.finalRank; best = p.id; }
    }
    heroId = best ?? data.finalRanking[0] ?? data.pets[0]?.id;
  }
  // The component decides "your runner" vs "spotlight" from real ownership client-side, so
  // we pass the whole predicted-rank map (it can score whichever horse becomes the spotlight).
  const modelRanks = Object.fromEntries(modelRankByPet);

  return (
    <div className="mx-auto max-w-[1440px] px-3 py-6 md:px-6 md:py-8">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/race/${raceId}`} className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">Back to recap</Link>
        <Link href={`/api/v1/race/${raceId}/telemetry`} className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">Served by /api/v1/race/{raceId}/telemetry</Link>
      </div>
      <RaceTelemetry key={`tel-${raceId}`} data={data} heroPetId={heroId} modelRanks={modelRanks} raceTitle={`Race #${raceId}`} />
    </div>
  );
}
