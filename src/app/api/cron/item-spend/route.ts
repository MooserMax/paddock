import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { runItemSpendCron } from "@/lib/ingest/itemSpend";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// On-chain item-spend indexer. Cron-authed (never public): heavy chain work runs here, never
// at request time. Steady state is mode=incremental (cursor -> latest). A bounded
// ?from=&to=  range run indexes exactly that window WITHOUT advancing the cursor, used for the
// small-window verification before any full backfill. ?mode=full resumes the deploy->latest
// backfill in time-budgeted passes. Idempotent: item_purchases is keyed (tx_hash, log_index).
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const sp = req.nextUrl.searchParams;
    const fromRaw = sp.get("from");
    const toRaw = sp.get("to");
    const result = await runItemSpendCron({
      mode: sp.get("mode") ?? undefined,
      from: fromRaw != null ? BigInt(fromRaw) : undefined,
      to: toRaw != null ? BigInt(toRaw) : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
