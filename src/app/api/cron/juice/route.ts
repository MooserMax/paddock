import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { computeJuiceRevenue } from "@/lib/ingest/juice";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GigaJuice revenue indexer. Cron-authed (never public). Enumerates Juice buys (selector
// 0x52ce66cc to the two Juice contracts) via the explorer, sums fixed tier prices in integer wei,
// buckets 24h/7d, and stores the snapshot. Read-only; never sends a tx. The homepage row is gated
// on the reconciled flag (all-time near Dune's 440 ETH / 41,600 buys).
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const snapshot = await computeJuiceRevenue();
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
