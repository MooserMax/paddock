import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { materializeRecords } from "@/lib/ingest/records";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dedicated cron for racing records: it scans the full race_entries table (~75k
// rows), heavier than the per-cycle incremental work, so it runs on its own
// schedule rather than every 5 minutes. Records change slowly, so an infrequent
// refresh is fine. Also run in the GitHub Action ingest-all pass.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const result = await materializeRecords();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
