// Full race backfill: scan every racing event from the contract's first block,
// then hydrate every resolved race from the public race API. Resumable: both
// steps checkpoint, so it is safe to stop and rerun.
//
// Run: npm run backfill:races
import { hydrateRaces, scanRaces } from "../src/lib/ingest/races";

console.log("== Paddock race backfill ==");

for (;;) {
  const scan = await scanRaces(60_000);
  console.log(
    `scanned blocks ${scan.fromBlock}..${scan.toBlock}  +${scan.created} created  +${scan.resolved} resolved`
  );
  if (scan.caughtUp) break;
}
console.log("scan caught up with chain head");

let totalHydrated = 0;
for (;;) {
  const result = await hydrateRaces(100);
  totalHydrated += result.hydrated;
  console.log(`hydrated ${totalHydrated} races (~${result.remaining} remaining)`);
  if (result.hydrated === 0) break;
}
console.log("hydration complete");
