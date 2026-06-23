import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getRecentWins } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Recent paid-race wins with the winner's actual take, in ETH and USD. Read-only.
// The homepage feed polls this; the short s-maxage fans repeat viewers out to one
// computation.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  return guard(async () => {
    const board = await getRecentWins(12);
    return ok(board, { sMaxAge: 15, staleWhileRevalidate: 30 });
  });
}
