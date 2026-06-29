import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { syncEthPrice } from "@/lib/ingest/ethPrice";
import { catchUpRaces, hydrateRaces, scanResolvedRacesRpc } from "@/lib/ingest/races";
import { rollingPetSync } from "@/lib/ingest/pets";
import { scanPetTransfers } from "@/lib/ingest/petOwnership";
import { materializeScoresFor } from "@/lib/ingest/scores";
import { materializeStableSkill } from "@/lib/ingest/stableSkill";
import { syncAccounts } from "@/lib/ingest/accounts";
import { materializeRecords } from "@/lib/ingest/records";
import { runItemSpendCron } from "@/lib/ingest/itemSpend";
import { runRaceGasCron } from "@/lib/ingest/raceGas";
import { computePaidVolume24h } from "@/lib/ingest/paidVolume";
import { computeJuiceRevenue } from "@/lib/ingest/juice";
import { getSyncState, setSyncState } from "@/lib/syncState";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby hard cap. Every path below aims for ~40s.

// The set-and-forget incremental cycle, driven by an external 15-minute cron.
// Each call processes only the delta since the last cursor and is bounded by
// both a race-count cap and a wall-clock deadline, so it always returns well
// under the 60s function limit. If the delta is large (e.g. after downtime) it
// processes a chunk, reports moreRemain=true, and the next ping continues from
// the advanced cursor. The full valuation/calibration recompute is NOT on this
// path (it cannot fit 60s); it runs via the GitHub Action (workflow_dispatch).
// Budgets are sized so a steady-state call lands well under 30s (friendly to an
// external scheduler's request timeout, e.g. cron-job.org), and any call stays
// far under Vercel's 60s function cap. A large delta (post-downtime) is chunked
// across calls via moreRemain rather than run long.
const MAX_RACES_PER_CALL = 45; // forward catch-up cap: must out-pace race creation
const CATCHUP_GAP_MS = 300; // race-API polling gap during catch-up (vs 500 default)
const MAX_HYDRATE_PER_CALL = 24; // open -> resolved per call; reduced because the RPC scan now resolves most races from chain, hydrate is the fallback for temp it could not enrich plus zombie cleanup
const RPC_TEMP_BUDGET = 18; // bounded race_temp/fee REST reads inside the RPC resolved-race scan
const RPC_DEADLINE_MS = 12_000; // sub-budget for the RPC scan's bounded REST enrichment
const HYDRATE_GAP_MS = 300; // race-API polling gap during hydration
const ABANDON_LAG_IDS = 250; // unresolved shells this far below the frontier are abandoned
const PET_BUDGET = 120; // just-raced pets refreshed (then re-scored) per call
const ACCOUNT_LOOKUPS_PER_CALL = 6; // displayed-owner username lookups per call
const ACCOUNT_REFRESH_DAYS = 14; // re-check a resolved address this infrequently
const RACE_DEADLINE_MS = 26_000; // wall-clock budget for the race-API polling
const SOFT_DEADLINE_MS = 34_000; // stop starting new pet/score work past this
const ACCOUNT_DEADLINE_MS = 40_000; // accounts run in whatever budget remains
// Records board: recompute on THIS reliable fast cron, not only the GitHub Action
// (whose schedule GitHub frequently delays/skips for hours, which stranded the board
// ~37h stale while the underlying tables stayed fresh). Bounded so it can never push
// the function past its cap: it only STARTS early in the cycle and at most every
// RECORDS_MIN_INTERVAL_MS. DB-only (no RPC), so no quota risk.
const RECORDS_MIN_INTERVAL_MS = 12 * 60_000; // refresh records at most this often
const RECORDS_START_BY_MS = 16_000; // only begin the records recompute this early in the cycle
const RECORDS_LAST_RUN_KEY = "records_last_run";
// On-chain item-spend incremental: same reliable-cadence pattern as records. The cursor
// advance over the tiny per-cycle block delta is cheap; re-materializing the snapshots is the
// cost, so it is gated by a min-interval AND only STARTS early in the cycle, never pushing the
// function past its cap. A long cycle simply defers it to the next call. DB + one small
// eth_getLogs, fault isolated.
const ITEM_SPEND_MIN_INTERVAL_MS = 10 * 60_000;
const ITEM_SPEND_START_BY_MS = 30_000; // only begin item-spend this early in the cycle
const ITEM_SPEND_LAST_RUN_KEY = "item_spend_last_run";
// Race gas fees: same gated pattern, interval offset from item-spend so the two materializes
// rarely land in the same cycle, and a tighter early-start so it only runs with good headroom.
const RACE_GAS_MIN_INTERVAL_MS = 11 * 60_000;
const RACE_GAS_START_BY_MS = 22_000;
const RACE_GAS_LAST_RUN_KEY = "race_gas_last_run";
// Juice revenue: enumerate via the explorer (~10s); the total is frozen (buying paused), so a
// slow cadence is plenty, with a tight early-start so it only runs with good headroom.
const JUICE_MIN_INTERVAL_MS = 30 * 60_000;
const JUICE_START_BY_MS = 18_000;
const JUICE_LAST_RUN_KEY = "juice_last_run";
const LOCK_KEY = "ingest_lock";
const LOCK_TTL_MS = 90_000; // a crashed run self-releases after this

interface IngestLock {
  startedAt: number;
  done: boolean;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Bump the races_scan row's updated_at without disturbing its value, so the
// site's "Synced" indicator (racesScannedAt) advances on every successful run.
async function touchRacesScannedAt(): Promise<string> {
  const cur = await getSyncState<Record<string, unknown>>("races_scan");
  await setSyncState("races_scan", cur ?? null);
  return new Date().toISOString();
}

export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;

  const t0 = Date.now();
  const raceDeadline = t0 + RACE_DEADLINE_MS;
  const softDeadline = t0 + SOFT_DEADLINE_MS;
  const timeLeft = () => Date.now() < softDeadline;

  // Overlap guard: no-op if a run is already in flight. The TTL means a run that
  // dies without releasing (e.g. a hard function timeout) self-clears.
  const lock = await getSyncState<IngestLock>(LOCK_KEY);
  if (lock && !lock.done && t0 - lock.startedAt < LOCK_TTL_MS) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "another run in flight",
      lockAgeMs: t0 - lock.startedAt,
    });
  }
  await setSyncState(LOCK_KEY, { startedAt: t0, done: false } satisfies IngestLock);

  const steps: Record<string, unknown> = {};
  try {
    // Cheap: one fetch, keeps USD conversions current.
    try {
      steps.ethPrice = await syncEthPrice();
    } catch (e) {
      steps.ethPriceError = msg(e);
    }

    // 0. Resolved-race records from the Abstract RPC: finish times, order, track,
    //    field, owners and payouts come from RACE_RESOLVED/CONFIG/CREATED/JOINED
    //    logs in one batched eth_getLogs, not a per-race REST fetch, so the records
    //    spine is unthrottled and gap-free. Only race_temp (off-chain) is filled by
    //    a small bounded REST read here. Runs first so the records data lands even
    //    if the REST budget below is tight.
    try {
      steps.resolvedRpc = await scanResolvedRacesRpc({ tempBudget: RPC_TEMP_BUDGET, deadline: t0 + RPC_DEADLINE_MS });
    } catch (e) {
      steps.resolvedRpcError = msg(e);
    }

    // 0c. Records board recompute on the reliable cadence. Placed right after the
    //     resolved scan so it reads the freshest finish times. Gated by a min-interval
    //     and an early-start budget check, so with the ~15-min external cron the board
    //     refreshes within ~15 min regardless of the GitHub Action, and a long cycle
    //     simply defers it to the next call rather than risking the function cap.
    try {
      const lastRec = await getSyncState<{ at: number }>(RECORDS_LAST_RUN_KEY);
      const due = !lastRec || t0 - (lastRec.at ?? 0) >= RECORDS_MIN_INTERVAL_MS;
      if (due && Date.now() < t0 + RECORDS_START_BY_MS) {
        steps.records = await materializeRecords();
        await setSyncState(RECORDS_LAST_RUN_KEY, { at: Date.now() });
      } else {
        steps.recordsSkipped = due ? "deadline" : "interval";
      }
    } catch (e) {
      steps.recordsError = msg(e);
    }

    // 0b. Keep pet ownership current from on-chain Transfer logs, so a transferred
    //     pet shows for its new owner within a cycle rather than only after it next
    //     races. Free RPC, one small eth_getLogs, fault isolated.
    try {
      steps.petTransfers = await scanPetTransfers();
    } catch (e) {
      steps.petTransfersError = msg(e);
    }

    // 1. Forward race discovery from our cursor up to the frontier (bounded).
    const catchup = await catchUpRaces(MAX_RACES_PER_CALL, raceDeadline, CATCHUP_GAP_MS);
    steps.catchup = catchup;

    // 2. Resolve finished races (mostly newest-first, so the live frontier always
    //    resolves within the cycle and is never starved behind old shells; a small
    //    oldest slice clears confirmed-dead phase-1 zombies, fetched and checked so
    //    a finished race is never abandoned blindly). Shares the race-API budget.
    let hydrate = { hydrated: 0, terminal: 0, remaining: 0 };
    if (Date.now() < raceDeadline) {
      hydrate = await hydrateRaces(MAX_HYDRATE_PER_CALL, raceDeadline, HYDRATE_GAP_MS, ABANDON_LAG_IDS);
      steps.hydrate = hydrate;
    } else {
      steps.hydrateSkipped = "race deadline";
    }

    // 3. Refresh exactly the pets that just raced (priority-1 of rollingPetSync),
    //    then re-score ONLY those, so a just-raced horse's ELO / win rate / CQ
    //    move within this cycle.
    let pets = { candidates: 0, synced: 0, ids: [] as number[] };
    if (timeLeft()) {
      pets = await rollingPetSync({ maxPets: PET_BUDGET });
      steps.pets = { candidates: pets.candidates, synced: pets.synced };
    } else {
      steps.petsSkipped = "soft deadline";
    }

    let scored = { scored: 0 };
    if (pets.ids.length && timeLeft()) {
      scored = await materializeScoresFor(pets.ids);
      steps.scores = scored;
    } else if (pets.ids.length) {
      steps.scoresSkipped = "soft deadline";
    }

    // 3b. Recompute the stable skill board (full-population aggregate over the
    //     current pet_scores; recomputes POP_MEAN and re-derives K each run). A
    //     few seconds; gated on the soft deadline like the rest.
    if (timeLeft()) {
      try {
        steps.stableSkill = await materializeStableSkill();
      } catch (e) {
        steps.stableSkillError = msg(e);
      }
    } else {
      steps.stableSkillSkipped = "soft deadline";
    }

    // 3c. On-chain item spend: advance the cursor over the small block delta since last run
    //     and re-materialize the spend + top-spender snapshots. Gated like records (min-interval
    //     + early-start) so it only runs with spare budget and never risks the function cap; a
    //     long cycle defers it. Idempotent (tx_hash+log_index) and fault isolated.
    if (timeLeft()) {
      try {
        const lastItem = await getSyncState<{ at: number }>(ITEM_SPEND_LAST_RUN_KEY);
        const dueItem = !lastItem || t0 - (lastItem.at ?? 0) >= ITEM_SPEND_MIN_INTERVAL_MS;
        if (dueItem && Date.now() < t0 + ITEM_SPEND_START_BY_MS) {
          steps.itemSpend = await runItemSpendCron({ mode: "incremental", budgetMs: 8_000, resolveLimit: 25 });
          await setSyncState(ITEM_SPEND_LAST_RUN_KEY, { at: Date.now() });
        } else {
          steps.itemSpendSkipped = dueItem ? "deadline" : "interval";
        }
      } catch (e) {
        steps.itemSpendError = msg(e);
      }
    } else {
      steps.itemSpendSkipped = "soft deadline";
    }

    // 3d. Player race gas fees: advance the cursor over the small per-cycle block delta and
    //     re-sum the snapshot. Same gated reliable-cadence pattern as records/item-spend, with
    //     an offset interval and tighter early-start so it only runs with spare budget.
    //     Idempotent (tx_hash) and fault isolated.
    if (timeLeft()) {
      try {
        const lastGas = await getSyncState<{ at: number }>(RACE_GAS_LAST_RUN_KEY);
        const dueGas = !lastGas || t0 - (lastGas.at ?? 0) >= RACE_GAS_MIN_INTERVAL_MS;
        if (dueGas && Date.now() < t0 + RACE_GAS_START_BY_MS) {
          steps.raceGas = await runRaceGasCron({ mode: "incremental", budgetMs: 8_000 });
          await setSyncState(RACE_GAS_LAST_RUN_KEY, { at: Date.now() });
        } else {
          steps.raceGasSkipped = dueGas ? "deadline" : "interval";
        }
      } catch (e) {
        steps.raceGasError = msg(e);
      }
    } else {
      steps.raceGasSkipped = "soft deadline";
    }

    // 3e. Trailing-24h paid racing volume (entry fees staked into paid races, money in). Cheap:
    //     a couple of DB reads from already-indexed races/entries, recomputed each tick so the
    //     24h window slides. Fault isolated; no chain access.
    try {
      steps.paidVolume24h = await computePaidVolume24h();
    } catch (e) {
      steps.paidVolume24hError = msg(e);
    }

    // 3f. GigaJuice revenue: enumerate Juice buys (explorer txlist) and re-bucket the windows.
    //     ~10s of explorer calls, so gated to a min-interval (the all-time total is frozen since
    //     buying paused). Fault isolated; no chain access.
    if (timeLeft()) {
      try {
        const lastJuice = await getSyncState<{ at: number }>(JUICE_LAST_RUN_KEY);
        const dueJuice = !lastJuice || t0 - (lastJuice.at ?? 0) >= JUICE_MIN_INTERVAL_MS;
        if (dueJuice && Date.now() < t0 + JUICE_START_BY_MS) {
          steps.juice = await computeJuiceRevenue();
          await setSyncState(JUICE_LAST_RUN_KEY, { at: Date.now() });
        } else {
          steps.juiceSkipped = dueJuice ? "deadline" : "interval";
        }
      } catch (e) {
        steps.juiceError = msg(e);
      }
    } else {
      steps.juiceSkipped = "soft deadline";
    }

    // 4. Resolve Gigaverse usernames for a small slice of displayed owners, in
    //    whatever budget remains. Capped + deadline-gated; the rest spills to the
    //    next cycle (full backfill is the GitHub Action's job).
    let accounts = { candidates: 0, looked: 0, named: 0, remaining: 0 };
    const accountDeadline = t0 + ACCOUNT_DEADLINE_MS;
    if (Date.now() < accountDeadline) {
      try {
        accounts = await syncAccounts({
          maxLookups: ACCOUNT_LOOKUPS_PER_CALL,
          refreshDays: ACCOUNT_REFRESH_DAYS,
          deadline: accountDeadline,
        });
        steps.accounts = accounts;
      } catch (e) {
        steps.accountsError = msg(e);
      }
    } else {
      steps.accountsSkipped = "deadline";
    }

    // Advance the "Synced" indicator the site footer reads.
    const racesScannedAt = await touchRacesScannedAt();

    // moreRemain is gated on reaching the frontier, not on perpetually-open
    // (pending) races, which are normal steady state.
    const moreRemain = !catchup.caughtUp;

    return NextResponse.json({
      ok: true,
      racesIngested: catchup.inserted + hydrate.hydrated, // newly seen + newly resolved
      racesCreated: catchup.inserted,
      newResolved: catchup.resolved + hydrate.hydrated,
      racesScanned: catchup.scanned,
      cursor: catchup.reachedRaceId, // highest race id reached
      caughtUp: catchup.caughtUp,
      moreRemain,
      pendingHydration: hydrate.remaining,
      petsSynced: pets.synced,
      scored: scored.scored,
      usernamesLooked: accounts.looked,
      usernamesResolved: accounts.named,
      usernamesRemaining: accounts.remaining,
      racesScannedAt,
      tookMs: Date.now() - t0,
      steps,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: msg(err), tookMs: Date.now() - t0, steps }, { status: 500 });
  } finally {
    await setSyncState(LOCK_KEY, { startedAt: t0, done: true } satisfies IngestLock).catch(() => {});
  }
}
