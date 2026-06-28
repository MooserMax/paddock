import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getSyncState } from "@/lib/syncState";
import { ITEM_STATS_KEY, type ItemStatsAgg } from "@/lib/ingest/itemSpend";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Precomputed on-chain item-spend aggregates (native ETH, integer-wei derived). Served from
// sync_state, never touches the chain. Returns null fields cleanly before the first index so
// callers can omit the section gracefully. itemIds render as "Item #<id>" (catalog is gated).
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return guard(async () => {
    const stats = await getSyncState<ItemStatsAgg>(ITEM_STATS_KEY);
    if (!stats) {
      return ok(
        { available: false, currency: "ETH", totalSpendWei: "0", totalSpendEth: "0", itemsBought: 0, uniqueBuyers: 0, byItem: [], window7d: null },
        { sMaxAge: 120, staleWhileRevalidate: 600 }
      );
    }
    return ok({ available: true, currency: "ETH", ...stats }, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
