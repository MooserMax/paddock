import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { runJuiceCron } from "@/lib/ingest/juice";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GigaJuice revenue indexer. Cron-authed (never public): the heavy work runs here, never at
// request time. mode=full resumes the deploy->head backfill (one 2M-block segment per call,
// folded into running inflow/outflow totals); mode=incremental (default) scans only new blocks.
// Read-only; never sends a tx. The homepage row is gated on the reconciled flag.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const result = await runJuiceCron({ mode: req.nextUrl.searchParams.get("mode") ?? undefined });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
