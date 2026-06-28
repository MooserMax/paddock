import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getSyncState } from "@/lib/syncState";
import { ITEM_LEADERBOARD_KEY, type ItemLeaderboardAgg } from "@/lib/ingest/itemSpend";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function OPTIONS() {
  return preflight();
}

// Precomputed top-spender leaderboard (native ETH), ranked by total spend. Buyers only
// (transferredTo); a seller can never appear here. Served from sync_state, no chain at
// request time. Returns available:false cleanly before the first index.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  let limit = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(MAX_LIMIT, Math.floor(limit));

  return guard(async () => {
    const board = await getSyncState<ItemLeaderboardAgg>(ITEM_LEADERBOARD_KEY);
    if (!board) {
      return ok({ available: false, currency: "ETH", spenders: [], uniqueBuyers: 0 }, { sMaxAge: 120, staleWhileRevalidate: 600 });
    }
    return ok(
      { available: true, currency: "ETH", uniqueBuyers: board.uniqueBuyers, generatedAt: board.generatedAt, spenders: board.spenders.slice(0, limit) },
      { sMaxAge: 120, staleWhileRevalidate: 600 }
    );
  });
}
