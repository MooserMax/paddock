import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getSyncState } from "@/lib/syncState";
import { RACE_GAS_KEY, type RaceGasAgg } from "@/lib/ingest/raceGas";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Precomputed total player gas spent on race CREATE + ENTER transactions (native ETH, summed
// from real receipts). Served from sync_state, never touches the chain. This is transaction
// fees only, separate from entry-fee volume and item spend.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return guard(async () => {
    const agg = await getSyncState<RaceGasAgg>(RACE_GAS_KEY);
    if (!agg) {
      return ok({ available: false, complete: false, currency: "ETH", scope: "race create + enter gas fees", totalFeeWei: "0", totalFeeEth: "0", txCount: 0 }, { sMaxAge: 120, staleWhileRevalidate: 600 });
    }
    return ok({ available: true, currency: "ETH", scope: "race create + enter gas fees", ...agg }, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
