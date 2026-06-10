// Full pet population backfill: enumerate token ids from 1 upward in polite
// batches until the API stops returning pets for a long stretch. Resumable
// via the pets_backfill checkpoint in sync_state.
//
// Run: npm run backfill:pets
import { PETS_BATCH_SIZE, REQUEST_GAP_MS, sleep } from "../src/lib/gigaverse";
import { syncPetBatch } from "../src/lib/ingest/pets";
import { getSyncState, setSyncState } from "../src/lib/syncState";

const STATE_KEY = "pets_backfill";
const EMPTY_STREAK_LIMIT = 12;

const state = await getSyncState<{ nextId: number }>(STATE_KEY);
let nextId = state?.nextId ?? 1;
let emptyStreak = 0;
let total = 0;

console.log(`== Paddock pet backfill == starting at id ${nextId}`);

while (emptyStreak < EMPTY_STREAK_LIMIT) {
  const ids = Array.from({ length: PETS_BATCH_SIZE }, (_, i) => nextId + i);
  const found = await syncPetBatch(ids);
  total += found;
  emptyStreak = found === 0 ? emptyStreak + 1 : 0;
  nextId += PETS_BATCH_SIZE;
  await setSyncState(STATE_KEY, { nextId });
  if (nextId % 1000 < PETS_BATCH_SIZE) {
    console.log(`cursor at id ${nextId}, ${total} pets synced this run`);
  }
  await sleep(REQUEST_GAP_MS);
}

console.log(
  `done: ${total} pets synced this run, stopped after ${EMPTY_STREAK_LIMIT} empty batches at id ${nextId}`
);
