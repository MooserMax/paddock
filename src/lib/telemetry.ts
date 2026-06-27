// Race telemetry: server-side fetch of Gigaverse's public per-tick resolver output,
// transformed into a lean, client-ready shape for the side-scroll visualization.
//
// Source: POST https://gigaverse.io/api/racing/race/{id}/tick  (public, no auth, empty
// body). Only resolvable/resolved races return data; a still-forming race (phase 1)
// returns 409. The resolved payload is IMMUTABLE, so we memoize finished races in-process
// and the route adds a long edge cache: fetched once per raceId, never refetched per view.
//
// Keying is by raceResult.pets[] INDEX, not pet id. Every position/rank/speed array in a
// tick is indexed the same way. We keep that index keying through to the client.

import type { RaceTelemetryData, TelemetryFrame } from "./api/types";

const TICK_BASE = "https://gigaverse.io/api/racing/race";
const TARGET_FRAMES = 240; // downsample target; real races are 600-1600 ticks

// Thrown when the race is not yet resolvable (Gigaverse 409). The route maps this to a
// clean "not available yet" response rather than a 500.
export class TelemetryUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelemetryUnavailable";
  }
}

interface TickResponse {
  success: boolean;
  data?: {
    raceId: number;
    phase: number;
    raceBeginsAt: number;
    finished: boolean;
    finalRanking: number[];
    msFinishTimes: number[];
    raceResult: {
      config: { trackLength: number; secondsPerTick: number; numPets: number };
      pets: { id: number; factionId: number; finishedAtTick: number; finalRank: number }[];
      ticks: { positions: number[]; ranks: number[]; speedMultipliers: number[] }[];
    };
  };
  error?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const memo = new Map<number, RaceTelemetryData>();

async function fetchTick(raceId: number): Promise<TickResponse> {
  const res = await fetch(`${TICK_BASE}/${raceId}/tick`, {
    method: "POST",
    headers: { accept: "application/json", "content-length": "0" },
    cache: "no-store",
  });
  if (res.status === 409) throw new TelemetryUnavailable("This race is not running yet. Telemetry appears once it starts resolving.");
  if (!res.ok) throw new Error(`Gigaverse tick ${res.status} for race ${raceId}`);
  const body = (await res.json()) as TickResponse;
  if (!body.success || !body.data) throw new TelemetryUnavailable(body.error ?? "Telemetry is not available for this race.");
  return body;
}

function transform(raceId: number, body: TickResponse): RaceTelemetryData {
  const d = body.data!;
  const rr = d.raceResult;
  const ticks = rr.ticks ?? [];
  const total = ticks.length;
  const spt = rr.config.secondsPerTick;
  const sampleEvery = Math.max(1, Math.ceil(total / TARGET_FRAMES));

  const frames: TelemetryFrame[] = [];
  const pushFrame = (i: number, spdMax: number[]) => {
    const t = ticks[i];
    frames.push({ tMs: Math.round(i * spt * 1000), pos: t.positions.map(r2), spd: spdMax.map(r3), rank: t.ranks.slice() });
  };
  for (let i = 0; i < total; i += sampleEvery) {
    // Carry the MAX speed multiplier across the downsampled window so a real surge is
    // never averaged away, then key the frame to the window's first tick.
    const spd = ticks[i].speedMultipliers.slice();
    for (let j = i + 1; j < Math.min(i + sampleEvery, total); j++) {
      const s = ticks[j].speedMultipliers;
      for (let k = 0; k < spd.length; k++) if (s[k] > spd[k]) spd[k] = s[k];
    }
    pushFrame(i, spd);
  }
  // Always include the final tick so the finish reads true.
  if (total > 0 && (total - 1) % sampleEvery !== 0) pushFrame(total - 1, ticks[total - 1].speedMultipliers.slice());

  return {
    raceId,
    trackLength: rr.config.trackLength,
    secondsPerTick: spt,
    numPets: rr.config.numPets,
    finished: !!d.finished,
    phase: d.phase,
    raceBeginsAt: d.raceBeginsAt,
    pets: rr.pets.map((p) => ({ id: p.id, finalRank: p.finalRank })),
    finalRanking: d.finalRanking ?? [],
    msFinishTimes: d.msFinishTimes ?? [],
    frames,
    totalTicks: total,
    sampleEvery,
    source: "gigaverse-tick",
  };
}

export async function fetchRaceTelemetry(raceId: number): Promise<RaceTelemetryData> {
  const cached = memo.get(raceId);
  if (cached) return cached;
  const data = transform(raceId, await fetchTick(raceId));
  // Only a resolved race is immutable; cache those. A live race keeps refetching.
  if (data.finished) {
    if (memo.size > 256) memo.clear();
    memo.set(raceId, data);
  }
  return data;
}
