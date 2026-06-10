// Recompute pet_scores for the whole population. Run after a pets backfill or
// whenever the scoring engine changes.
//
// Run: npm run materialize
import { materializeScores } from "../src/lib/ingest/scores";

console.log("== Paddock score materialization ==");
const result = await materializeScores();
console.log(`scored ${result.scored} pets, ${result.valued} with a valuation band`);
