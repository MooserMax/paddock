// Diagnostic (read-only): is the odds model's high-end overconfidence concentrated
// on the same shark-tier horses the scanner flags? If the high-predicted entries are
// the shark cohort, and they win ~51% not ~84%, then the scanner and the odds model
// are telling ONE truth from two angles: elite horses are strong but not as dominant
// as a naive favorite-take implies. Walk-forward, held-out only (matches the backtest).
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = 0.1418, K = 25, BETA = 19, SHARK = 0.3;
const shrunk = (w, r) => (w + BASE * K) / (r + K);

const entries = [];
for (let from = 0; ; from += 1000) {
  const { data } = await db.from("race_entries").select("race_id, pet_id, finish_position").not("finish_position", "is", null).order("race_id", { ascending: true }).range(from, from + 999);
  if (!data || !data.length) break;
  entries.push(...data);
  if (data.length < 1000) break;
}
const races = new Map();
for (const e of entries) { if (!races.has(e.race_id)) races.set(e.race_id, []); races.get(e.race_id).push({ petId: e.pet_id, won: e.finish_position === 1 }); }
const raceIds = [...races.keys()].sort((a, b) => a - b);
const cutoffIdx = Math.floor(raceIds.length * 0.7);

const prior = new Map();
const held = []; // { pred, priorShrunk, won }
raceIds.forEach((raceId, idx) => {
  const field = races.get(raceId).map((e) => {
    const rec = prior.get(e.petId) ?? { w: 0, r: 0 };
    return { s: shrunk(rec.w, rec.r), won: e.won };
  });
  const z = field.map((f) => BETA * (f.s - BASE));
  const m = Math.max(...z);
  const ex = z.map((v) => Math.exp(v - m));
  const sum = ex.reduce((a, b) => a + b, 0) || 1;
  if (idx >= cutoffIdx) field.forEach((f, i) => held.push({ pred: ex[i] / sum, priorShrunk: f.s, won: f.won }));
  for (const e of races.get(raceId)) { const rec = prior.get(e.petId) ?? { w: 0, r: 0 }; prior.set(e.petId, { w: rec.w + (e.won ? 1 : 0), r: rec.r + 1 }); }
});

const rate = (arr) => arr.length ? arr.filter((x) => x.won).length / arr.length : 0;
const highPred = held.filter((h) => h.pred >= 0.5);
const highPredShark = highPred.filter((h) => h.priorShrunk >= SHARK);
const sharkTier = held.filter((h) => h.priorShrunk >= SHARK);

console.log(`held-out entries: ${held.length}`);
console.log(`\n--- high-predicted entries (model says >= 50%) ---`);
console.log(`count: ${highPred.length}`);
console.log(`share that are shark-tier (prior shrunk >= 0.30): ${(100 * highPredShark.length / highPred.length).toFixed(1)}%`);
console.log(`their ACTUAL win rate: ${(100 * rate(highPred)).toFixed(1)}%  (model predicted ~84-95% in these buckets)`);
console.log(`\n--- shark-tier held-out entries (prior shrunk >= 0.30) ---`);
console.log(`count: ${sharkTier.length}, actual win rate: ${(100 * rate(sharkTier)).toFixed(1)}%`);
console.log(`\n--- the coherent number ---`);
console.log(`mean predicted prob for high-pred entries: ${(100 * highPred.reduce((a, h) => a + h.pred, 0) / highPred.length).toFixed(1)}%`);
console.log(`actual: ${(100 * rate(highPred)).toFixed(1)}%  -> overconfidence gap is on the elite cohort`);
