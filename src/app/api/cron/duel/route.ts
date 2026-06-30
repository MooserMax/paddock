import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { indexDuels } from "@/lib/ingest/duelIndex";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Duel indexer. Cron-authed (never public). Scans PetDuelingSystem for global stats, lineage,
// and per-pet duels-left into sync_state. Read-only; never submits a duel.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const r = await indexDuels();
    return NextResponse.json({ ok: true, duelsResolved: r.duelsResolved, duelbornMinted: r.duelbornMinted, listingsCreated: r.listingsCreated, duelsEngaged: r.duelsEngaged, restores: r.restores, challengeFeesWei: r.challengeFeesWei, lineageCount: r.lineage.length, lastIndexedBlock: r.lastIndexedBlock });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
