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
    .eq("hydrated", false)
    .order("race_id", { ascending: true })
    .limit(maxRaces);
  if (error) throw new Error(`hydration candidate query failed: ${error.message}`);

  let hydrated = 0;
  for (const row of data ?? []) {
    const race = await fetchRace(row.race_id);
    await sleep(REQUEST_GAP_MS);
    // Resolved is signalled by a populated finalRanking, not a specific phase
    // number (resolved races are phase 3 or 4). Open races are left for a later
    // run, still hydrated=false.
    const isResolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
    if (!race.success || !isResolved) continue;

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
        resolved: true,
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

// API-driven forward discovery. The public RPC's eth_getLogs does not serve
// recent logs (it lags ~2.6 days and growing), so it is blind to new races. The
// Gigaverse race API is current, so we discover races by id from our max upward,
// inserting each (resolved with entries if finished, else as an open row to be
// resolved later by hydrateRaces). This is what actually advances us to head.
export interface CatchUpResult {
  scanned: number;
  inserted: number;
  resolved: number;
  fromRaceId: number;
  reachedRaceId: number;
  caughtUp: boolean;
}

const MISSING_STREAK_LIMIT = 6;

export async function catchUpRaces(maxRaces: number): Promise<CatchUpResult> {
  const { data: maxRow } = await db()
    .from("races")
    .select("race_id")
    .order("race_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startId = (maxRow?.race_id ?? 0) + 1;

  let id = startId;
  let scanned = 0;
  let inserted = 0;
  let resolved = 0;
  let missing = 0;

  while (missing < MISSING_STREAK_LIMIT && scanned < maxRaces) {
    let race: Awaited<ReturnType<typeof fetchRace>> | null = null;
    try {
      race = await fetchRace(id);
    } catch {
      race = null;
    }
    await sleep(REQUEST_GAP_MS);
    scanned += 1;

    // A nonexistent race comes back without a phase or pets. Real races (open or
    // resolved) carry a field and a pet list.
    const exists =
      !!race && race.success && race.phase != null && Array.isArray(race.racePets) && race.racePets.length > 0;
    if (!exists || !race) {
      missing += 1;
      id += 1;
      continue;
    }
    missing = 0;

    const isResolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
    const maxFinishMs = isResolved && race.finishTimes.length > 0 ? Math.max(...race.finishTimes) : 0;

    const { error: rErr } = await db().from("races").upsert(
      {
        race_id: id,
        field_size: race.fieldSize ?? null,
        track_length: race.trackLength ?? null,
        race_temp: race.raceTemp ?? null,
        entry_fee_wei: race.entryFee ?? null,
        creator: race.creator?.toLowerCase() ?? null,
        payout_bps: race.payoutBps ?? null,
        fee_bps: {
          creator: race.creatorFeeBps,
          protocol: race.protocolFeeBps,
          protocolJuiced: race.protocolFeeBpsJuiced,
          jackpot: race.jackpotBps,
        },
        race_start: race.raceStart ? new Date(race.raceStart * 1000).toISOString() : null,
        resolved: isResolved,
        resolved_at: isResolved ? new Date((race.raceStart + maxFinishMs / 1000) * 1000).toISOString() : null,
        hydrated: isResolved,
      },
      { onConflict: "race_id" }
    );
    if (rErr) throw new Error(`catchup race upsert failed: ${rErr.message}`);
    inserted += 1;

    if (isResolved) {
      const entryRows = race.finalRanking.map((petId, i) => ({
        race_id: id,
        pet_id: petId,
        owner_address: race.petOwners[String(petId)]?.toLowerCase() ?? null,
        finish_position: i + 1,
        finish_time_ms: race.finishTimes[i] ?? null,
        payout_wei: race.petPayouts[String(petId)]?.amount ?? null,
      }));
      if (entryRows.length > 0) {
        const { error: eErr } = await db().from("race_entries").upsert(entryRows, { onConflict: "race_id,pet_id" });
        if (eErr) throw new Error(`catchup entries upsert failed: ${eErr.message}`);
      }
      resolved += 1;
    }
    id += 1;
  }

  return { scanned, inserted, resolved, fromRaceId: startId, reachedRaceId: id - 1, caughtUp: missing >= MISSING_STREAK_LIMIT };
}
