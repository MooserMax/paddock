import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { syncEthPrice } from "@/lib/ingest/ethPrice";
import { catchUpRaces, hydrateRaces } from "@/lib/ingest/races";
import { rollingPetSync } from "@/lib/ingest/pets";
import { materializeScoresFor } from "@/lib/ingest/scores";
import { materializeStableSkill } from "@/lib/ingest/stableSkill";
import { syncAccounts } from "@/lib/ingest/accounts";
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
const MAX_HYDRATE_PER_CALL = 36; // open -> resolved per call; ~28 newest out-pace the ~15/cycle finish rate with margin, 8 oldest clear zombies
const HYDRATE_GAP_MS = 300; // race-API polling gap during hydration
const ABANDON_LAG_IDS = 250; // unresolved shells this far below the frontier are abandoned
const PET_BUDGET = 120; // just-raced pets refreshed (then re-scored) per call
const ACCOUNT_LOOKUPS_PER_CALL = 6; // displayed-owner username lookups per call
const ACCOUNT_REFRESH_DAYS = 14; // re-check a resolved address this infrequently
const RACE_DEADLINE_MS = 26_000; // wall-clock budget for the race-API polling
const SOFT_DEADLINE_MS = 34_000; // stop starting new pet/score work past this
const ACCOUNT_DEADLINE_MS = 40_000; // accounts run in whatever budget remains
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
