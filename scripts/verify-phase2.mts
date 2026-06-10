// Phase 2 verification: check the scoring engine against known cases from the
// brief, and sanity-check the population-level leaderboards.
//
// Run: npm run verify:phase2
import { db } from "../src/lib/db";

const want = [6249, 3010, 15874, 22999];

const { data: scores, error } = await db()
  .from("pet_scores")
  .select("*")
  .in("pet_id", want);
if (error) throw new Error(error.message);

const { data: pets } = await db()
  .from("pets")
  .select("id, name, rarity_name, races_run, wins")
  .in("id", want);
const petById = new Map((pets ?? []).map((p) => [p.id, p]));

console.log("== Known cases ==");
for (const id of want) {
  const s = scores?.find((r) => r.pet_id === id);
  const p = petById.get(id);
  if (!s || !p) {
    console.log(`#${id}: MISSING (score:${!!s} pet:${!!p})`);
    continue;
  }
  console.log(
    `#${id} ${p.rarity_name} run=${p.races_run} wins=${p.wins}  ` +
      `confirmed=${s.confirmed_quality} upside=${s.upside} reveal=${(s.reveal_progress * 100).toFixed(0)}% ` +
      `bestDist=${s.best_distance}m milestone_in=${s.next_milestone_in} traits=${s.traits_revealed}/${s.traits_total}`
  );
}

const rank = async (col: string, label: string) => {
  const { data } = await db()
    .from("pet_scores")
    .select(`pet_id, ${col}`)
    .order(col, { ascending: false, nullsFirst: false })
    .limit(10);
  console.log(`\n== Top 10 by ${label} ==`);
  for (const r of data ?? []) console.log(`  #${(r as Record<string, unknown>).pet_id}: ${(r as Record<string, number>)[col]}`);
};

await rank("confirmed_quality", "confirmed quality");
await rank("upside", "upside (unrevealed potential)");

// Checks against brief expectations.
const get = (id: number) => scores?.find((r) => r.pet_id === id);
const checks: [string, boolean][] = [
  ["3010 best distance is 2400m", get(3010)?.best_distance === 2400],
  ["6249 has a confirmed-quality score", (get(6249)?.confirmed_quality ?? 0) > 0],
];
console.log("\n== Checks ==");
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) allPass = false;
}
process.exit(allPass ? 0 : 1);
