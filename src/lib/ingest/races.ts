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
  terminal: number;
  remaining: number;
}

// A race that reached the game's terminal phase (4) without ever producing a
// finalRanking never ran: it was created but did not draw enough entrants and
// expired. We mark these hydrated=true while leaving resolved=false, so they are
// a distinct "abandoned" state, no longer retried forever and no longer counted
// as pending against the resolved total.
const TERMINAL_PHASE = 4;

// Fill in race details from the public race API. Resolved races get full details
// + entries; terminal (expired-unfilled) races get classified so they stop being
// retried; open races are left hydrated=false for a later run.
export async function hydrateRaces(maxRaces: number, deadline?: number): Promise<HydrateResult> {
  const { data, error, count } = await db()
    .from("races")
    .select("race_id", { count: "exact" })
    .eq("hydrated", false)
    .order("race_id", { ascending: true })
    .limit(maxRaces);
  if (error) throw new Error(`hydration candidate query failed: ${error.message}`);

  let hydrated = 0;
  let terminal = 0;
  for (const row of data ?? []) {
    // Stop cleanly if we are out of wall-clock budget; the remaining count is
    // returned so the caller knows more work is pending for the next run.
    if (deadline && Date.now() > deadline) break;
    const race = await fetchRace(row.race_id);
    await sleep(REQUEST_GAP_MS);
    if (!race.success) continue;

    const isResolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
    if (!isResolved) {
      // Expired without running: classify terminal so it stops being a candidate
      // and stops dragging the resolved count. Open races (phase < 4) stay pending.
      if (typeof race.phase === "number" && race.phase >= TERMINAL_PHASE) {
        const { error: tErr } = await db()
          .from("races")
          .update({
            field_size: race.fieldSize ?? null,
            track_length: race.trackLength ?? null,
            entry_fee_wei: race.entryFee ?? null,
            race_start: race.raceStart ? new Date(race.raceStart * 1000).toISOString() : null,
            hydrated: true,
          })
          .eq("race_id", row.race_id);
        if (tErr) throw new Error(`terminal-race classify failed: ${tErr.message}`);
        terminal += 1;
      }
      continue;
    }

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

  return { hydrated, terminal, remaining: (count ?? 0) - hydrated - terminal };
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

// Upsert one race (plus its entries if resolved) from a fetched API payload.
// Shared by forward catch-up and gap backfill. Returns whether it was resolved.
async function upsertRaceFromApi(id: number, race: Awaited<ReturnType<typeof fetchRace>>): Promise<boolean> {
  const isResolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
  const maxFinishMs = isResolved && race.finishTimes.length > 0 ? Math.max(...race.finishTimes) : 0;
  // A non-resolved race already at the terminal phase never ran (expired empty):
  // mark it hydrated so it is the "abandoned" state, not retried or left pending.
  const isTerminal = !isResolved && typeof race.phase === "number" && race.phase >= TERMINAL_PHASE;

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
      hydrated: isResolved || isTerminal,
    },
    { onConflict: "race_id" }
  );
  if (rErr) throw new Error(`race upsert failed: ${rErr.message}`);

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
      if (eErr) throw new Error(`race_entries upsert failed: ${eErr.message}`);
    }
  }
  return isResolved;
}

export interface BackfillResult {
  scanned: number;
  inserted: number;
  resolved: number;
  missing: number;
}

// Fetch and upsert a specific set of race ids: the historical gaps the forward
// catch-up skipped (abandoned-empty races, and races that were empty when first
// passed and have since resolved). Idempotent; existing rows are re-upserted.
export async function ingestRacesByIds(ids: number[], gapMs: number = REQUEST_GAP_MS): Promise<BackfillResult> {
  let scanned = 0;
  let inserted = 0;
  let resolved = 0;
  let missing = 0;
  for (const id of ids) {
    let race: Awaited<ReturnType<typeof fetchRace>> | null = null;
    try {
      race = await fetchRace(id);
    } catch {
      race = null;
    }
    await sleep(gapMs);
    scanned += 1;
    const exists = !!race && race.success && race.phase != null;
    if (!exists || !race) {
      missing += 1;
      continue;
    }
    if (await upsertRaceFromApi(id, race)) resolved += 1;
    inserted += 1;
  }
  return { scanned, inserted, resolved, missing };
}

export async function catchUpRaces(maxRaces: number, deadline?: number, gapMs: number = REQUEST_GAP_MS): Promise<CatchUpResult> {
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

  // Bounded by race count AND wall-clock: caughtUp stays false if we stop on the
  // deadline before hitting the missing-streak frontier, so the caller continues
  // from the new cursor next run.
  while (missing < MISSING_STREAK_LIMIT && scanned < maxRaces && (!deadline || Date.now() < deadline)) {
    let race: Awaited<ReturnType<typeof fetchRace>> | null = null;
    try {
      race = await fetchRace(id);
    } catch {
      race = null;
    }
    await sleep(gapMs);
    scanned += 1;

    // A real (created) race id returns success with a phase, even when it has not
    // drawn entrants yet or expired empty (phase 4, racePets 0). Only a hard
    // success=false means the id does not exist. Requiring racePets here used to
    // skip real-but-empty races AND inflate the missing streak, which could halt
    // catch-up before the true frontier; treat any real race as existing so we
    // always reach head (empty ones go in as open rows for hydrateRaces to
    // classify terminal).
    const exists = !!race && race.success && race.phase != null;
    if (!exists || !race) {
      missing += 1;
      id += 1;
      continue;
    }
    missing = 0;

    if (await upsertRaceFromApi(id, race)) resolved += 1;
    inserted += 1;
    id += 1;
  }

  return { scanned, inserted, resolved, fromRaceId: startId, reachedRaceId: id - 1, caughtUp: missing >= MISSING_STREAK_LIMIT };
}
