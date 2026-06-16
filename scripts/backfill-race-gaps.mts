// One-time backfill of historical race-id gaps the old forward catch-up skipped
// (abandoned-empty races, and races that were empty when first passed and have
// since resolved). Idempotent and safe to re-run.
import { db } from "../src/lib/db";
import { ingestRacesByIds } from "../src/lib/ingest/races";

const ids = new Set<number>();
const PAGE = 1000;
let max = 0;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db().from("races").select("race_id").order("race_id", { ascending: true }).range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) {
    const id = r.race_id as number;
    ids.add(id);
    if (id > max) max = id;
  }
  if (data.length < PAGE) break;
}

const missing: number[] = [];
for (let i = 1; i <= max; i++) if (!ids.has(i)) missing.push(i);
console.log(`rows=${ids.size} max=${max} missing=${missing.length}`);

const res = await ingestRacesByIds(missing, 300);
console.log("backfill:", JSON.stringify(res));
console.log(`=> ${res.resolved} resolved races recovered, ${res.inserted - res.resolved} abandoned recorded, ${res.missing} truly nonexistent`);
