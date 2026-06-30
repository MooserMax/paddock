import type { NextRequest } from "next/server";
import { ok, guard, badRequest, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getBestPairings } from "@/lib/api/queries";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Best-pairings suggester: rank a stable's viable male+female pairings by predicted outcome /
// expected net value, from indexed data + the fitted model. Read-only; no per-pet live calls.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("A valid wallet address is required.");
  const goalRaw = req.nextUrl.searchParams.get("goal");
  const goal = goalRaw === "rarity" ? "rarity" : "value";
  return guard(async () => {
    const result = await getBestPairings(address, goal);
    return ok(result, { sMaxAge: 60, staleWhileRevalidate: 300 });
  });
}
