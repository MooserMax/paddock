import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { runRaceGasCron } from "@/lib/ingest/raceGas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Player race gas-fee indexer. Cron-authed (never public): heavy chain work (event scan +
// receipt fetch + sum) runs here, never at request time. Steady state is mode=incremental
// (cursor -> latest). ?from=&to= indexes a bounded range WITHOUT advancing the cursor (for the
// small-window verification). ?mode=full resumes the deploy->latest backfill in budgeted
// passes. Idempotent: race_gas_fees is keyed by tx_hash.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const sp = req.nextUrl.searchParams;
    const fromRaw = sp.get("from");
    const toRaw = sp.get("to");
    const result = await runRaceGasCron({
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
