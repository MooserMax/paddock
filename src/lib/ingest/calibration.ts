import { db } from "../db";
import { setSyncState } from "../syncState";

// Out-of-sample, walk-forward calibration backtest for the odds model, run as a
// scheduled job and written to sync_state['calibration_v1'] for instant reads.
// Mirrors scripts/backtest-odds.mjs exactly. Leak-free: each race's prediction
// uses only prior records; the parameter is fit on the earlier 70% and the curve
// is published on the held-out later 30%.

const BASE = 0.1418;
const K = 25;
const shrunk = (w: number, r: number) => (w + BASE * K) / (r + K);

interface Sample {
  raceId: number;
  field: { shrunk: number; won: boolean }[];
}

export interface CalibrationRunResult {
  testRaces: number;
  brier: number;
  baselineBrier: number;
  buckets: number;
}

export async function runCalibration(): Promise<CalibrationRunResult> {
  // Load finished entries chronologically (paginated; Supabase caps at 1000).
  const entries: { race_id: number; pet_id: number; finish_position: number }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("race_entries")
      .select("race_id, pet_id, finish_position")
      .not("finish_position", "is", null)
      .order("race_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`calibration scan failed: ${error.message}`);
    if (!data || data.length === 0) break;
    entries.push(...(data as typeof entries));
    if (data.length < PAGE) break;
  }

  const races = new Map<number, { petId: number; won: boolean }[]>();
  for (const e of entries) {
    if (!races.has(e.race_id)) races.set(e.race_id, []);
    races.get(e.race_id)!.push({ petId: e.pet_id, won: e.finish_position === 1 });
  }
  const raceIds = [...races.keys()].sort((a, b) => a - b);

  const prior = new Map<number, { w: number; r: number }>();
  const samples: Sample[] = [];
  for (const raceId of raceIds) {
    const field = races.get(raceId)!.map((e) => {
      const rec = prior.get(e.petId) ?? { w: 0, r: 0 };
      return { shrunk: shrunk(rec.w, rec.r), won: e.won };
    });
    samples.push({ raceId, field });
    for (const e of races.get(raceId)!) {
      const rec = prior.get(e.petId) ?? { w: 0, r: 0 };
      prior.set(e.petId, { w: rec.w + (e.won ? 1 : 0), r: rec.r + 1 });
    }
  }

  const cutoffIdx = Math.floor(samples.length * 0.7);
  const cutoffRaceId = samples[cutoffIdx]?.raceId ?? 0;
  const train = samples.slice(0, cutoffIdx);
  const test = samples.slice(cutoffIdx);

  const predict = (field: Sample["field"], beta: number) => {
    const z = field.map((f) => beta * (f.shrunk - BASE));
    const m = Math.max(...z);
    const ex = z.map((v) => Math.exp(v - m));
    const s = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map((v) => v / s);
  };
  const logLoss = (set: Sample[], beta: number) => {
    let ll = 0, n = 0;
    for (const race of set) {
      const p = predict(race.field, beta);
      race.field.forEach((f, i) => {
        const pi = Math.min(1 - 1e-9, Math.max(1e-9, p[i]));
        ll += -(f.won ? Math.log(pi) : Math.log(1 - pi));
        n++;
      });
    }
    return n ? ll / n : Infinity;
  };

  let bestBeta = 0, bestLL = Infinity;
  for (let beta = 0; beta <= 20; beta += 0.5) {
    const ll = logLoss(train, beta);
    if (ll < bestLL) { bestLL = ll; bestBeta = beta; }
  }

  const buckets = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, sumP: 0, wins: 0, count: 0 }));
  let brier = 0, baseBrier = 0, n = 0, ll = 0, testWins = 0;
  for (const race of test) {
    const p = predict(race.field, bestBeta);
    const uniform = 1 / race.field.length;
    race.field.forEach((f, i) => {
      const pi = p[i];
      brier += (pi - (f.won ? 1 : 0)) ** 2;
      baseBrier += (uniform - (f.won ? 1 : 0)) ** 2;
      const cl = Math.min(1 - 1e-9, Math.max(1e-9, pi));
      ll += -(f.won ? Math.log(cl) : Math.log(1 - cl));
      n++;
      if (f.won) testWins++;
      const b = buckets[Math.min(9, Math.floor(pi * 10))];
      b.sumP += pi; b.wins += f.won ? 1 : 0; b.count++;
    });
  }

  const round = (x: number, p = 5) => Math.round(x * 10 ** p) / 10 ** p;
  const result = {
    modelVersion: "odds-v1-winrate-core",
    scope: "Win-rate-driven probability, validated out of sample. ELO and stat reveals are current-only in our data and would leak past outcomes, so they are excluded from the historical curve; the live odds endpoint adds them and labels them uncalibrated.",
    split: { method: "temporal walk-forward", cutoffRaceId, trainRaces: train.length, testRaces: test.length, fittedBeta: bestBeta },
    metrics: {
      heldOutEntries: n,
      brier: round(brier / n),
      baselineBrier: round(baseBrier / n),
      logLoss: round(ll / n),
      fieldBaselineWinRate: round(testWins / n, 4),
    },
    buckets: buckets.filter((b) => b.count > 0).map((b) => ({
      lo: b.lo, hi: b.hi, predictedMean: round(b.sumP / b.count, 4), actualFreq: round(b.wins / b.count, 4), count: b.count,
    })),
  };

  await setSyncState("calibration_v1", result);
  return { testRaces: test.length, brier: result.metrics.brier, baselineBrier: result.metrics.baselineBrier, buckets: result.buckets.length };
}
