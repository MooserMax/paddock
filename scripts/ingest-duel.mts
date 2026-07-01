// Duel ingest: index PetDuelingSystem, fit the empirical model, store the training set, and
// hydrate every Duelborn / duel participant into the pets table (the Part 0 backfill).
//
// Run locally: node --env-file=.env.local --import tsx scripts/ingest-duel.mts
import { indexDuels } from "../src/lib/ingest/duelIndex";
import { fitDuelModel } from "../src/lib/ingest/duelModel";

const t = Date.now();
const idx = await indexDuels();
console.log(`index: duelsResolved=${idx.duelsResolved} duelbornMinted=${idx.duelbornMinted} parentsBurned=${idx.parentsBurned} lastBlock=${idx.lastIndexedBlock}`);
const m = await fitDuelModel();
console.log(`model: n=${m.n}`);
console.log(`  rarity backtest ${m.backtest.rarity.correct}/${m.backtest.rarity.n}`);
console.log(`  generation ${m.backtest.generation.correct}/${m.backtest.generation.n}`);
console.log(`  gender ${m.backtest.gender.correct}/${m.backtest.gender.n}`);
console.log(`  faction ${m.backtest.faction.correct}/${m.backtest.faction.n}`);
console.log(`  statFloor ${m.backtest.statFloor.correct}/${m.backtest.statFloor.n}`);
console.log(`  statFloor lookup ${JSON.stringify(m.statFloor)}`);
console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
