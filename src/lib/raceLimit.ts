import { fetchJoinedLogs, latestBlock } from "./chain";

// Stable per-pet daily-limit verdict. Gigaverse caps a pet at DAILY_RACE_LIMIT
// races per rolling 24h (verified: limit 2, trailing 24h, matching the game's N/2
// counter and the on-chain joinRace revert). The OLD approach simulated joinRace
// against a specific forming race and treated any revert as "exhausted", which
// flickered: that revert also fires for a full or mid-transition race and for a pet
// momentarily busy, none of which are daily exhaustion. So a genuinely eligible pet
// (4967 at 1/2) was intermittently hidden.
//
// This computes the verdict from a STABLE signal instead: count a pet's RACE_JOINED
// events (topic2 = petId) in the trailing daily window. Event counts do not depend
// on any single race's joinability, so for an unchanged chain state the verdict does
// not oscillate. A shared, incrementally-maintained window is scanned once and
// reused across pets and viewers; it falls open on RPC error so a transient failure
// never produces a false "exhausted".

export const DAILY_RACE_LIMIT = 2;
const WINDOW_BLOCKS = 172_800n; // ~24h at ~0.5s/block on Abstract
const REFRESH_MS = 20_000;
const COLD_CHUNK = 40_000n;

// petId -> sorted block numbers of its RACE_JOINED events within the window.
let joins = new Map<number, number[]>();
let cursor: bigint | null = null;
let head = 0n;
let lastRefresh = 0;
let inflight: Promise<void> | null = null;

function petOf(topic: string | undefined): number {
  return topic ? Number(BigInt(topic)) : 0;
}

async function doRefresh(): Promise<void> {
  const tip = await latestBlock();
  const from = cursor == null ? (tip - WINDOW_BLOCKS > 0n ? tip - WINDOW_BLOCKS : 0n) : cursor + 1n;
  if (from <= tip) {
    // On a cold start this is the 24h backfill (a few chunks, fetched in parallel);
    // steady state is a single tiny incremental range since the last cursor.
    const ranges: [bigint, bigint][] = [];
    for (let b = from; b <= tip; b += COLD_CHUNK) {
      ranges.push([b, b + COLD_CHUNK - 1n > tip ? tip : b + COLD_CHUNK - 1n]);
    }
    const chunks = await Promise.all(ranges.map(([lo, hi]) => fetchJoinedLogs(lo, hi)));
    for (const logs of chunks) {
      for (const l of logs) {
        const pet = petOf(l.topics[2]);
        if (!pet) continue;
        const arr = joins.get(pet) ?? [];
        arr.push(Number(BigInt(l.blockNumber)));
        joins.set(pet, arr);
      }
    }
  }
  cursor = tip;
  head = tip;
  // Prune anything older than the window so the map stays bounded and the count is
  // always the trailing-24h count.
  const cutoff = Number(tip - WINDOW_BLOCKS);
  for (const [pet, blocks] of joins) {
    const kept = blocks.filter((b) => b > cutoff);
    if (kept.length) joins.set(pet, kept);
    else joins.delete(pet);
  }
  lastRefresh = Date.now();
}

// The subset of petIds that have hit the daily race limit. Stable for an unchanged
// chain state. Falls open (returns empty) on any RPC error.
export async function dailyExhausted(petIds: number[]): Promise<Set<number>> {
  try {
    if (cursor == null || Date.now() - lastRefresh >= REFRESH_MS) {
      if (!inflight) inflight = doRefresh().finally(() => { inflight = null; });
      await inflight;
    }
  } catch {
    return new Set(); // uncertainty: never hide a pet on a transient failure
  }
  const cutoff = Number(head - WINDOW_BLOCKS);
  const out = new Set<number>();
  for (const id of petIds) {
    const count = (joins.get(id) ?? []).filter((b) => b > cutoff).length;
    if (count >= DAILY_RACE_LIMIT) out.add(id);
  }
  return out;
}
