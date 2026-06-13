// Read-only snapshot of the full pet_scores table for before/after diffing.
// Paginates (the very thing we are auditing) so it never itself hits the cap.
// Usage: node --env-file=.env.local scripts/snapshot-scores.mjs > snapshot.json
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const all = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("pet_scores")
    .select("pet_id, confirmed_quality, upside, best_distance, reveal_progress, valuation_low_eth, valuation_high_eth, valuation_comps")
    .order("pet_id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < PAGE) break;
}

const num = (x) => (x === null || x === undefined ? 0 : Number(x));
const sum = (k) => all.reduce((a, r) => a + num(r[k]), 0);
const nonThin = all.filter((r) => r.valuation_comps && r.valuation_comps.thin === false).length;

const byCQ = [...all].sort((a, b) => num(b.confirmed_quality) - num(a.confirmed_quality)).slice(0, 15);
const byUpside = [...all].sort((a, b) => num(b.upside) - num(a.upside)).slice(0, 15);
const checks = [6249, 3010, 15874, 22999].map((id) => all.find((r) => r.pet_id === id) ?? { pet_id: id, missing: true });

const out = {
  count: all.length,
  sumConfirmed: Number(sum("confirmed_quality").toFixed(3)),
  sumUpside: Number(sum("upside").toFixed(3)),
  nonThinValuations: nonThin,
  bestDistanceHistogram: all.reduce((h, r) => { h[r.best_distance] = (h[r.best_distance] ?? 0) + 1; return h; }, {}),
  checkCases: checks.map((r) => ({ pet_id: r.pet_id, cq: num(r.confirmed_quality), upside: num(r.upside), best: r.best_distance, reveal: num(r.reveal_progress), valLow: r.valuation_low_eth, valHigh: r.valuation_high_eth })),
  top15CQ: byCQ.map((r) => ({ pet_id: r.pet_id, cq: Number(num(r.confirmed_quality).toFixed(3)) })),
  top15Upside: byUpside.map((r) => ({ pet_id: r.pet_id, upside: Number(num(r.upside).toFixed(3)) })),
};
console.log(JSON.stringify(out, null, 2));
