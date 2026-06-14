// One-time: catch race ingestion up from our DB max to the current head via the
// Gigaverse race API (the RPC's eth_getLogs is blind to recent blocks). Loops
// until it reaches the head. Resumable: each batch advances the DB max.
//
// Run: npm run catchup:races
import { catchUpRaces } from "../src/lib/ingest/races";
import { db } from "../src/lib/db";

const before = (await db().from("races").select("*", { count: "exact", head: true })).count ?? 0;
console.log(`racesCreated before: ${before}`);

let totalInserted = 0;
let totalResolved = 0;
for (;;) {
  const r = await catchUpRaces(500);
  totalInserted += r.inserted;
  totalResolved += r.resolved;
  console.log(`scanned ${r.scanned} (race ${r.fromRaceId}..${r.reachedRaceId})  +${r.inserted} inserted, ${r.resolved} resolved  caughtUp=${r.caughtUp}`);
  if (r.caughtUp || r.scanned === 0) break;
}

const after = (await db().from("races").select("*", { count: "exact", head: true })).count ?? 0;
const resolvedAfter = (await db().from("races").select("*", { count: "exact", head: true }).eq("resolved", true)).count ?? 0;
const { data: maxRow } = await db().from("races").select("race_id").order("race_id", { ascending: false }).limit(1).maybeSingle();
console.log(`\nracesCreated after: ${after} (was ${before}, +${after - before})`);
console.log(`resolved after: ${resolvedAfter} | max race_id: ${maxRow?.race_id}`);
console.log(`this run inserted ${totalInserted}, of which ${totalResolved} resolved`);
