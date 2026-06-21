// The full ingest pipeline as a standalone script, run by the GitHub Action
// scheduler. GitHub runners have no ~60s Vercel-Hobby function cap, so the race
// catch-up (which fetches each new race politely at 500ms) can fully reach head
// every run and KEEP PACE, rather than getting cut like the consolidated Vercel
// cron does at volume. Reuses the exact same ingest functions.
//
// Run locally: node --env-file=.env.local --import tsx scripts/ingest-all.mts
import { syncEthPrice } from "../src/lib/ingest/ethPrice";
import { scanRaces, catchUpRaces, hydrateRaces } from "../src/lib/ingest/races";
import { rollingPetSync } from "../src/lib/ingest/pets";
import { syncSales } from "../src/lib/ingest/sales";
import { materializeScores } from "../src/lib/ingest/scores";
import { materializeStableSkill } from "../src/lib/ingest/stableSkill";
import { runCalibration } from "../src/lib/ingest/calibration";
import { syncAccounts } from "../src/lib/ingest/accounts";

async function run(name: string, fn: () => Promise<unknown>) {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`OK   ${name.padEnd(15)} ${((Date.now() - t) / 1000).toFixed(1)}s  ${JSON.stringify(r).slice(0, 160)}`);
  } catch (e) {
    console.log(`FAIL ${name.padEnd(15)} ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

// Dependency order; generous budgets because there is no function-duration cap.
await run("eth-price", () => syncEthPrice());
await run("races-scan", () => scanRaces(60_000));
await run("races-catchup", () => catchUpRaces(5000));
// hydrate resolves newest-first and abandons confirmed-dead shells past the lag.
await run("races-hydrate", () => hydrateRaces(1000, undefined, undefined, 250));
await run("pets", () => rollingPetSync({ maxPets: 800 }));
await run("sales", () => syncSales());
await run("scores", () => materializeScores());
await run("stable-skill", () => materializeStableSkill());
await run("calibration", () => runCalibration());
// No duration cap here, so backfill every displayed owner (all four boards,
// including top earners) in one pass.
await run("accounts", () => syncAccounts({ maxLookups: 3000, refreshDays: 14, includeEarnings: true }));
console.log("ingest-all complete");
