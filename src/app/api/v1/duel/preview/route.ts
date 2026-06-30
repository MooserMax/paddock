import type { NextRequest } from "next/server";
import { ok, guard, badRequest, notFound, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getDuelPreview } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Deterministic breeding preview for two Giglings by id. Returns CERTAIN outcomes (generation +
// its flat boost, gender rule), ODDS (faction, expected stats at midpoint), and PENDING (rarity %,
// stat ranges, traits) honestly separated. Read-only intelligence; never submits a duel.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const a = Number(req.nextUrl.searchParams.get("a"));
  const b = Number(req.nextUrl.searchParams.get("b"));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0) return badRequest("Two valid Gigling ids (a, b) are required.");
  return guard(async () => {
    const result = await getDuelPreview(a, b);
    if (!result) return notFound("One or both Giglings are not indexed yet.");
    return ok(result, { sMaxAge: 60, staleWhileRevalidate: 300 });
  });
}
