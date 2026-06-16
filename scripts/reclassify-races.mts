// One-time: re-run hydrate over all unresolved races to (a) resolve any that
// genuinely have a finalRanking now, and (b) classify expired-unfilled races as
// terminal so they stop being counted as pending.
import { hydrateRaces } from "../src/lib/ingest/races";
import { db } from "../src/lib/db";
const c = async (...f: [string, unknown][]) => { let q = db().from("races").select("*", { count: "exact", head: true }); for (const [k, v] of f) q = q.eq(k, v); return (await q).count ?? 0; };
console.log("BEFORE: resolved", await c(["resolved", true]), "| resolved=false", await c(["resolved", false]), "| hydrated=false", await c(["hydrated", false]));
let totalH = 0, totalT = 0;
for (;;) { const r = await hydrateRaces(400); totalH += r.hydrated; totalT += r.terminal; console.log(`  +${r.hydrated} hydrated, +${r.terminal} terminal, ~${r.remaining} remaining`); if (r.hydrated === 0 && r.terminal === 0) break; }
console.log("AFTER: resolved", await c(["resolved", true]), "| resolved=false", await c(["resolved", false]), "| abandoned", await c(["resolved", false], ["hydrated", true]), "| still-pending", await c(["hydrated", false]));
console.log(`reclassified: ${totalH} -> resolved, ${totalT} -> terminal`);
