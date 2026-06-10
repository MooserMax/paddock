import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { hydrateRaces, scanRaces } from "@/lib/ingest/races";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCAN_BUDGET_MS = 90_000;
const HYDRATE_PER_RUN = 120;

export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const scan = await scanRaces(SCAN_BUDGET_MS);
    const hydration = await hydrateRaces(HYDRATE_PER_RUN);
    return NextResponse.json({ ok: true, scan, hydration });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
