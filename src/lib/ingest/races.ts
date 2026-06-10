import { db } from "../db";
import {
  RACING_START_BLOCK,
  decodeRacingLog,
  fetchRacingLogs,
  latestBlock,
  RaceResolved,
} from "../chain";
import { fetchRace, sleep, REQUEST_GAP_MS } from "../gigaverse";
import { getSyncState, setSyncState } from "../syncState";

const SCAN_STATE_KEY = "races_scan";
const SCAN_WINDOW = 100_000n;

interface ScanState {
  lastBlock: string;
}

export interface ScanResult {
  fromBlock: string;
  toBlock: string;
  caughtUp: boolean;
  created: number;
  resolved: number;
}

// Scan RaceCreated / RaceResolved events forward from the checkpoint.
// The chain is the spine: this is gap-free and idempotent. Checkpoint moves
// only after a window is fully written, so a crash re-scans, never skips.
export async function scanRaces(budgetMs: number): Promise<ScanResult> {
  const deadline = Date.now() + budgetMs;
  const state = await getSyncState<ScanState>(SCAN_STATE_KEY);
  const startBlock = state ? BigInt(state.lastBlock) + 1n : RACING_START_BLOCK;
  const head = await latestBlock();

  let cursor = startBlock;
  let created = 0;
  let resolved = 0;

  while (cursor <= head && Date.now() < deadline) {
    const windowEnd = cursor + SCAN_WINDOW - 1n > head ? head : cursor + SCAN_WINDOW - 1n;
    const logs = await fetchRacingLogs(cursor, windowEnd);
    const events = logs
      .map(decodeRacingLog)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const createdRows = events
      .filter((e) => e.kind === "created")
      .map((e) => ({ race_id: Number(e.raceId), block_number: Number(e.blockNumber) }));
    if (createdRows.length > 0) {
      const { error } = await db()
        .from("races")
        .upsert(createdRows, { onConflict: "race_id", ignoreDuplicates: true });
      if (error) throw new Error(`races insert failed: ${error.message}`);
      created += createdRows.length;
    }

    const resolvedEvents = events.filter((e): e is RaceResolved => e.kind === "resolved");
    if (resolvedEvents.length > 0) {
      const { error } = await db()
        .from("races")
        .upsert(
          resolvedEvents.map((e) => ({ race_id: Number(e.raceId), resolved: true })),
          { onConflict: "race_id" }
        );
      if (error) throw new Error(`races resolve update failed: ${error.message}`);

      const entryRows = resolvedEvents.flatMap((e) =>
        e.finishOrder.map((petId, i) => ({
          race_id: Number(e.raceId),
          pet_id: Number(petId),
          finish_position: i + 1,
          finish_time_ms: Number(e.finishTimesMs[i] ?? 0) || null,
        }))
      );
      for (let i = 0; i < entryRows.length; i += 500) {
        const { error: entryError } = await db()
          .from("race_entries")
          .upsert(entryRows.slice(i, i + 500), { onConflict: "race_id,pet_id" });
        if (entryError) throw new Error(`race_entries upsert failed: ${entryError.message}`);
      }
      resolved += resolvedEvents.length;
    }

    await setSyncState(SCAN_STATE_KEY, { lastBlock: windowEnd.toString() } satisfies ScanState);
    cursor = windowEnd + 1n;
  }

  return {
    fromBlock: startBlock.toString(),
    toBlock: (cursor - 1n).toString(),
    caughtUp: cursor > head,
    created,
    resolved,
  };
}

export interface HydrateResult {
  hydrated: number;
  remaining: number;
}

// Fill in race details (track, fees, owners, payouts) from the public race
// API for resolved races the scanner has seen, politely and resumably.
export async function hydrateRaces(maxRaces: number): Promise<HydrateResult> {
  const { data, error, count } = await db()
    .from("races")
    .select("race_id", { count: "exact" })
    .eq("resolved", true)
    .eq("hydrated", false)
    .order("race_id", { ascending: true })
    .limit(maxRaces);
  if (error) throw new Error(`hydration candidate query failed: ${error.message}`);

  let hydrated = 0;
  for (const row of data ?? []) {
    const race = await fetchRace(row.race_id);
    await sleep(REQUEST_GAP_MS);
    if (!race.success || race.phase !== 3) continue;

    const maxFinishMs = race.finishTimes.length > 0 ? Math.max(...race.finishTimes) : 0;
    const resolvedAt = new Date((race.raceStart + maxFinishMs / 1000) * 1000).toISOString();

    const { error: raceError } = await db()
      .from("races")
      .update({
        field_size: race.fieldSize,
        track_length: race.trackLength,
        race_temp: race.raceTemp,
        entry_fee_wei: race.entryFee,
        creator: race.creator?.toLowerCase() ?? null,
        payout_bps: race.payoutBps,
        fee_bps: {
          creator: race.creatorFeeBps,
          protocol: race.protocolFeeBps,
          protocolJuiced: race.protocolFeeBpsJuiced,
          jackpot: race.jackpotBps,
        },
        race_start: new Date(race.raceStart * 1000).toISOString(),
        resolved_at: resolvedAt,
        hydrated: true,
      })
      .eq("race_id", row.race_id);
    if (raceError) throw new Error(`race hydration update failed: ${raceError.message}`);

    const entryRows = race.finalRanking.map((petId, i) => ({
      race_id: row.race_id,
      pet_id: petId,
      owner_address: race.petOwners[String(petId)]?.toLowerCase() ?? null,
      finish_position: i + 1,
      finish_time_ms: race.finishTimes[i] ?? null,
      payout_wei: race.petPayouts[String(petId)]?.amount ?? null,
    }));
    if (entryRows.length > 0) {
      const { error: entryError } = await db()
        .from("race_entries")
        .upsert(entryRows, { onConflict: "race_id,pet_id" });
      if (entryError) throw new Error(`race_entries hydration failed: ${entryError.message}`);
    }
    hydrated += 1;
  }

  return { hydrated, remaining: (count ?? 0) - hydrated };
}
