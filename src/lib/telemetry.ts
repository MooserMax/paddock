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

import type { RaceTelemetryData, TelemetryFrame, TelemetryItem } from "./api/types";

const TICK_BASE = "https://gigaverse.io/api/racing/race";
const STATS_URL = "https://gigaverse.io/api/racing/stats";
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
    scheduledItems?: { itemId: number; petId: number; amount: number; atTick: number; submittedBy?: string; submittedAt?: number; appliedAt?: number | null; refundedAt?: number | null }[];
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

  // Item usage: surface scheduledItems with the measured effect. boost = the target pet's
  // speedMultiplier at the applied tick (1.1 = +10 percent); null for a refunded item (no
  // effect) or when the tick/pet cannot be read. Names are not resolvable (catalog is gated).
  const petIndexById = new Map(rr.pets.map((p, i) => [p.id, i]));
  const items: TelemetryItem[] = (d.scheduledItems ?? []).map((e) => {
    const pi = petIndexById.get(e.petId);
    const fired = e.appliedAt != null && e.refundedAt == null;
    const t = Math.min(Math.max(0, e.atTick), total - 1);
    const boost = fired && pi != null && total > 0 && ticks[t]?.speedMultipliers?.[pi] != null ? r3(ticks[t].speedMultipliers[pi]) : null;
    return { itemId: e.itemId, petId: e.petId, amount: e.amount, atTick: e.atTick, submittedBy: e.submittedBy ?? null, appliedAt: e.appliedAt ?? null, refundedAt: e.refundedAt ?? null, boost };
  });

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
    items,
    totalTicks: total,
    sampleEvery,
    source: "gigaverse-tick",
  };
}

// Public global racing aggregates (server-side fetch, cached). Real numbers only; there
// is no item-consumption total here, so we never claim one. jackpotWins is honestly 0
// until one is won; jackpotPoolWei is the CURRENT unclaimed pool read from a recent race
// detail (the pool is global, so any recent race carries it). Null on failure.
export interface GigaStats {
  totalRacesCreated: number;
  racesResolved: number;
  totalEntries: number;
  uniqueRacers: number;
  uniqueCreators: number;
  totalEntryFeeVolumeWei: string;
  jackpotWins: number;
  jackpotPoolWei: string | null;
}
interface RawStats {
  totalRacesCreated: number; totalEntries: number; uniqueRacers: number; uniqueCreators: number;
  totalEntryFeeVolumeWei: string; totalJackpotWinsCount: number; racesByPhase?: Record<string, number>;
}
export async function fetchGigaStats(): Promise<GigaStats | null> {
  try {
    const res = await fetch(STATS_URL, { headers: { accept: "application/json" }, next: { revalidate: 600 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: RawStats };
    if (!body.success || !body.data) return null;
    const d = body.data;
    // Live jackpot pool from a recent race detail (best-effort; null if unavailable).
    let jackpotPoolWei: string | null = null;
    try {
      const r2 = await fetch(`${TICK_BASE}/${d.totalRacesCreated - 1}`, { headers: { accept: "application/json" }, next: { revalidate: 600 } });
      if (r2.ok) {
        const jr = (await r2.json()) as { jackpot?: { balance?: string } };
        jackpotPoolWei = jr.jackpot?.balance ?? null;
      }
    } catch { /* pool simply omitted */ }
    return {
      totalRacesCreated: d.totalRacesCreated,
      racesResolved: d.racesByPhase?.["3"] ?? 0,
      totalEntries: d.totalEntries,
      uniqueRacers: d.uniqueRacers,
      uniqueCreators: d.uniqueCreators,
      totalEntryFeeVolumeWei: d.totalEntryFeeVolumeWei,
      jackpotWins: d.totalJackpotWinsCount ?? 0,
      jackpotPoolWei,
    };
  } catch {
    return null;
  }
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
