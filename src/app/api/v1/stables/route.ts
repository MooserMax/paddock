import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getStableLeaderboard } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function OPTIONS() {
  return preflight();
}

// The stable leaderboard: wallets ranked by proven roster quality (shrunk average
// confirmed quality of their proven horses). Precomputed in the cron; this only
// reads and paginates. Honest envelope and tuned caching like the other reads.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  let limit = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  let offset = Number(sp.get("offset") ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(MAX_LIMIT, Math.floor(limit));
  offset = Math.floor(offset);

  return guard(async () => {
    const board = await getStableLeaderboard(limit, offset);
    return ok(board, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
