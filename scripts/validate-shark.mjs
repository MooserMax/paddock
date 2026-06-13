// Outcome-validate the SHARK threshold OUT OF SAMPLE (read-only).
// A horse's shrunk win rate is computed from its wins, so measuring flagged
// horses' win rate naively is circular. Instead: walk races in order, compute
// each pet's record BEFORE each race, flag on that prior record only, then score
// whether they won THAT race. The flag never sees the outcome it is judged on.
//
// Reports, per candidate threshold, the flagged cohort's actual win rate vs the
// field baseline, and finds where the real inflection is.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const BASE = 0.1418;
const K = 25;
const shrunk = (w, r) => (w + BASE * K) / (r + K);

// Load every entry with a finish position, ordered chronologically by race_id.
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
console.log(`loaded ${entries.length} finished entries`);

const THRESHOLDS = [0.2, 0.25, 0.28, 0.3, 0.33, 0.35, 0.4];
// Per threshold: flagged entries and how many were wins.
const stats = Object.fromEntries(THRESHOLDS.map((t) => [t, { flagged: 0, flaggedWins: 0 }]));
const prior = new Map(); // pet_id -> { w, r } BEFORE the current race

let totalEntries = 0;
let totalWins = 0;
for (const e of entries) {
  const rec = prior.get(e.pet_id) ?? { w: 0, r: 0 };
  const won = e.finish_position === 1;
  // Score the flag using ONLY the prior record (out of sample).
  if (rec.r > 0) {
    const s = shrunk(rec.w, rec.r);
    for (const t of THRESHOLDS) {
      if (s >= t) {
        stats[t].flagged++;
        if (won) stats[t].flaggedWins++;
      }
    }
  }
  totalEntries++;
  if (won) totalWins++;
  // Now fold this race into the pet's record for future races.
  prior.set(e.pet_id, { w: rec.w + (won ? 1 : 0), r: rec.r + 1 });
}

const baseline = totalWins / totalEntries;
console.log(`\nfield baseline win rate (any entry): ${(baseline * 100).toFixed(1)}%  (n=${totalEntries})`);
console.log(`\nthreshold | flagged entries | OUT-OF-SAMPLE win rate | lift vs baseline`);
for (const t of THRESHOLDS) {
  const s = stats[t];
  const wr = s.flagged ? s.flaggedWins / s.flagged : 0;
  const lift = baseline ? wr / baseline : 0;
  console.log(
    `  ${t.toFixed(2)}   |   ${String(s.flagged).padStart(6)}        |   ${(wr * 100).toFixed(1)}%` +
      `                |  ${lift.toFixed(2)}x`
  );
}
