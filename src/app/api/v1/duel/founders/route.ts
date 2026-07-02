import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getFounders } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Founders leaderboard: genesis Giglings that have seeded dynasties, ranked by Founder Score
// (offspring count + realized climb rate + dominant-trait concentration, components shown). Sortable
// by offspring, climb, or value. Read-only, from the resolved-duel training set + indexed data.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const sortRaw = sp.get("sort");
  const sort = sortRaw === "climb" || sortRaw === "value" ? sortRaw : "offspring";
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  return guard(async () => {
    const result = await getFounders(sort, limit, offset);
    return ok(result, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
