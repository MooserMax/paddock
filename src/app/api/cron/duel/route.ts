import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { indexDuels } from "@/lib/ingest/duelIndex";
import { fitDuelModel } from "@/lib/ingest/duelModel";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Duel indexer + empirical model fit. Cron-authed (never public). Scans PetDuelingSystem for
// global stats/lineage/duels-left, and fits the outcome model from real resolved duels. All into
// sync_state. Read-only; never submits a duel.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const r = await indexDuels();
    let model = null;
    try { const m = await fitDuelModel(); model = { n: m.n, backtest: m.backtest, fallN: m.fall.n, factionInherit: m.faction.inheritRate }; }
    catch (e) { model = { error: e instanceof Error ? e.message : String(e) }; }
    return NextResponse.json({ ok: true, duelsResolved: r.duelsResolved, duelbornMinted: r.duelbornMinted, listingsCreated: r.listingsCreated, duelsEngaged: r.duelsEngaged, restores: r.restores, challengeFeesWei: r.challengeFeesWei, lineageCount: r.lineage.length, parentsBurned: r.parentsBurned, gen2Pct: r.gen2Pct, lastIndexedBlock: r.lastIndexedBlock, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
