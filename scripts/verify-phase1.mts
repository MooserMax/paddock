// Phase 1 pass condition: our database race counts must match the on-chain
// event counts to the digit. This independently re-scans the whole chain
// (read-only, no DB writes) and compares.
//
// Run: npm run verify:phase1
import {
  RACING_START_BLOCK,
  TOPIC_RACE_CREATED,
  TOPIC_RACE_RESOLVED,
  fetchRacingLogs,
  latestBlock,
} from "../src/lib/chain";
import { db } from "../src/lib/db";

const WINDOW = 100_000n;
const head = await latestBlock();
console.log(`re-scanning chain ${RACING_START_BLOCK}..${head} (read-only)`);

const createdIds = new Set<string>();
const resolvedIds = new Set<string>();
for (let from = RACING_START_BLOCK; from <= head; from += WINDOW) {
  const to = from + WINDOW - 1n > head ? head : from + WINDOW - 1n;
  const logs = await fetchRacingLogs(from, to);
  for (const log of logs) {
    const raceId = BigInt(log.topics[1] ?? "0x0").toString();
    if (log.topics[0] === TOPIC_RACE_CREATED) createdIds.add(raceId);
    if (log.topics[0] === TOPIC_RACE_RESOLVED) resolvedIds.add(raceId);
  }
}

const count = async (resolvedOnly: boolean) => {
  let query = db().from("races").select("*", { count: "exact", head: true });
  if (resolvedOnly) query = query.eq("resolved", true);
  const { count: n, error } = await query;
  if (error) throw new Error(error.message);
  return n ?? 0;
};
const dbCreated = await count(false);
const dbResolved = await count(true);

console.log(`chain: ${createdIds.size} races created, ${resolvedIds.size} resolved`);
console.log(`db:    ${dbCreated} races created, ${dbResolved} resolved`);

const pass = dbCreated === createdIds.size && dbResolved === resolvedIds.size;
console.log(pass ? "PASS: database matches chain to the digit" : "FAIL: counts diverge");
process.exit(pass ? 0 : 1);
