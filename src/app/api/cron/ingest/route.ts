import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { syncEthPrice } from "@/lib/ingest/ethPrice";
import { scanRaces, hydrateRaces, catchUpRaces } from "@/lib/ingest/races";
import { rollingPetSync } from "@/lib/ingest/pets";
import { syncSales } from "@/lib/ingest/sales";
import { materializeScores } from "@/lib/ingest/scores";
import { runCalibration } from "@/lib/ingest/calibration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One daily cron orchestrating every ingest job in dependency order. Hobby caps
// the number of cron jobs, so the six jobs live behind this single schedule;
// each job's logic is unchanged, just sequenced here.
//
// Order is both dependency-correct AND resilience-ordered. The expensive race
// hydration (track/fees/owners enrichment) runs LAST on purpose: finish positions
// already come from the scan, so if the function is ever cut short by a duration
// limit, every critical job has already completed and only enrichment is deferred.
//
// Dependencies satisfied by this order:
//   eth-price -> sales needs ETH/USD
//   races-scan -> pets (recent-race priority), scores (entries), calibration (entries)
//   pets, sales -> scores (pet/trait data + sale comps)
//   races-scan -> calibration (finish positions)
//   races-hydrate -> nothing downstream depends on it, so it is safe to run last
//
// Each step is isolated: a failure is recorded and the run continues, so one
// flaky upstream (an API blip) never blocks the independent jobs.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;

  const steps: { name: string; ok: boolean; ms: number; result?: unknown; error?: string }[] = [];
  const run = async (name: string, fn: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      const result = await fn();
      steps.push({ name, ok: true, ms: Date.now() - start, result });
    } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Critical, fixed-cost jobs first so the materialized outputs the whole site
  // reads always complete. races-scan is kept light: the RPC's eth_getLogs is
  // blind to recent blocks, so it no longer drives forward progress, but it
  // refreshes the checkpoint + the "Data as of" footer timestamp and fills any
  // historical gaps cheaply.
  await run("eth-price", () => syncEthPrice());
  await run("races-scan", () => scanRaces(20_000));
  await run("pets", () => rollingPetSync({ maxPets: 400, staleMinutes: 30 }));
  await run("sales", () => syncSales());
  await run("scores", () => materializeScores());
  await run("calibration", () => runCalibration());
  // Forward race discovery via the race API (the real way we reach head), then
  // enrichment. Both are variable-length and nothing the pages materialize from
  // depends on them, so they are the safe tail if a duration limit ever cuts the run.
  await run("races-catchup", () => catchUpRaces(800));
  await run("races-hydrate", () => hydrateRaces(150));

  const ok = steps.every((s) => s.ok);
  // Always 200 so a single failed sub-job does not mark the whole cron as failed
  // and trigger noisy retries; the per-step ok flags carry the detail.
  return NextResponse.json({ ok, steps });
}
