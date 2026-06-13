// Out-of-sample, walk-forward calibration backtest for the odds model.
// Writes precomputed results to sync_state['calibration_v1'] so /calibration
// reads them instantly (never computed on request).
//
// LEAK-FREE BY CONSTRUCTION:
//   - Walk races in chronological order (race_id). For each race, each entrant's
//     win probability is computed from its PRIOR record only (races strictly
//     before this one). The outcome being predicted is never in the inputs.
//   - Temporal split: fit the one model parameter (softmax temperature beta) on
//     the EARLIER 70% of races; publish calibration ONLY on the held-out LATER 30%.
//   - Scope: ELO and stat reveals are current-only in our data and cannot be
//     point-in-time reconstructed, so including them would leak. The backtest
//     therefore calibrates the win-rate-driven core of odds-v1. This is stated
//     plainly on the /calibration page; the added live components are labeled
//     uncalibrated.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const BASE = 0.1418;
const K = 25;
const shrunk = (w, r) => (w + BASE * K) / (r + K);

// Load finished entries in chronological order.
const entries = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("race_entries")
    .select("race_id, pet_id, finish_position")
    .not("finish_position", "is", null)
    .order("race_id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  entries.push(...data);
  if (data.length < PAGE) break;
}

// Group by race, preserving race order.
const races = new Map(); // race_id -> [{pet_id, won}]
for (const e of entries) {
  if (!races.has(e.race_id)) races.set(e.race_id, []);
  races.get(e.race_id).push({ petId: e.pet_id, won: e.finish_position === 1 });
}
const raceIds = [...races.keys()].sort((a, b) => a - b);
console.log(`races with finishes: ${raceIds.length}`);

// Walk forward: capture each race's entrants' PRIOR shrunk rate + outcome.
const prior = new Map();
const samples = []; // { raceId, field: [{shrunk, won}] }
for (const raceId of raceIds) {
  const field = races.get(raceId).map((e) => {
    const rec = prior.get(e.petId) ?? { w: 0, r: 0 };
    return { shrunk: shrunk(rec.w, rec.r), won: e.won, petId: e.petId, rec };
  });
  samples.push({ raceId, field: field.map((f) => ({ shrunk: f.shrunk, won: f.won })) });
  // fold outcomes into records AFTER capturing the prior state
  for (const e of races.get(raceId)) {
    const rec = prior.get(e.petId) ?? { w: 0, r: 0 };
    prior.set(e.petId, { w: rec.w + (e.won ? 1 : 0), r: rec.r + 1 });
  }
}

// Temporal split.
const cutoffIdx = Math.floor(samples.length * 0.7);
const cutoffRaceId = samples[cutoffIdx].raceId;
const train = samples.slice(0, cutoffIdx);
const test = samples.slice(cutoffIdx);

// Model: p_i = softmax(beta * (shrunk_i - BASE)) over the field.
function predict(field, beta) {
  const z = field.map((f) => beta * (f.shrunk - BASE));
  const m = Math.max(...z);
  const ex = z.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map((v) => v / s);
}
function logLoss(set, beta) {
  let ll = 0, n = 0;
  for (const race of set) {
    const p = predict(race.field, beta);
    race.field.forEach((f, i) => {
      const pi = Math.min(1 - 1e-9, Math.max(1e-9, p[i]));
      ll += -(f.won ? Math.log(pi) : Math.log(1 - pi));
      n++;
    });
  }
  return ll / n;
}

// Fit beta on TRAIN only (grid search).
let bestBeta = 0, bestLL = Infinity;
for (let beta = 0; beta <= 20; beta += 0.5) {
  const ll = logLoss(train, beta);
  if (ll < bestLL) { bestLL = ll; bestBeta = beta; }
}
console.log(`fitted beta=${bestBeta} (train log loss ${bestLL.toFixed(4)})`);

// Evaluate on HELD-OUT test only.
const BUCKETS = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, sumP: 0, wins: 0, count: 0 }));
let brier = 0, baseBrier = 0, nEntries = 0, ll = 0;
for (const race of test) {
  const p = predict(race.field, bestBeta);
  const uniform = 1 / race.field.length;
  race.field.forEach((f, i) => {
    const pi = p[i];
    brier += (pi - (f.won ? 1 : 0)) ** 2;
    baseBrier += (uniform - (f.won ? 1 : 0)) ** 2;
    const cl = Math.min(1 - 1e-9, Math.max(1e-9, pi));
    ll += -(f.won ? Math.log(cl) : Math.log(1 - cl));
    nEntries++;
    const b = BUCKETS[Math.min(9, Math.floor(pi * 10))];
    b.sumP += pi; b.wins += f.won ? 1 : 0; b.count++;
  });
}

const result = {
  modelVersion: "odds-v1-winrate-core",
  scope: "Win-rate-driven probability, validated out of sample. ELO and stat reveals are current-only in our data and would leak past outcomes, so they are excluded from the historical curve; the live odds endpoint adds them and labels them uncalibrated.",
  split: { method: "temporal walk-forward", cutoffRaceId, trainRaces: train.length, testRaces: test.length, fittedBeta: bestBeta },
  metrics: {
    heldOutEntries: nEntries,
    brier: Number((brier / nEntries).toFixed(5)),
    baselineBrier: Number((baseBrier / nEntries).toFixed(5)),
    logLoss: Number((ll / nEntries).toFixed(5)),
    fieldBaselineWinRate: Number((test.reduce((a, r) => a + r.field.filter((f) => f.won).length, 0) / nEntries).toFixed(4)),
  },
  buckets: BUCKETS.filter((b) => b.count > 0).map((b) => ({
    lo: b.lo, hi: b.hi,
    predictedMean: Number((b.sumP / b.count).toFixed(4)),
    actualFreq: Number((b.wins / b.count).toFixed(4)),
    count: b.count,
  })),
};

console.log(JSON.stringify(result.metrics, null, 2));
console.log("buckets:", result.buckets.length);

const { error: writeErr } = await db
  .from("sync_state")
  .upsert({ key: "calibration_v1", value: result, updated_at: new Date().toISOString() });
if (writeErr) throw new Error(`calibration write failed: ${writeErr.message}`);
console.log("wrote sync_state['calibration_v1']");
