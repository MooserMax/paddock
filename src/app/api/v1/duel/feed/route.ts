import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { fetchDuelListings } from "@/lib/duel";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Live duel feed: preparing + completed listings from the Gigaverse duel API (rich: hostPet,
// challengerPet, offspring, loserPetId, survivorPetId, warnings). Read-only, server-side, cached.
// The on-chain duel index (/stats) is the ground-truth count; this is the per-duel detail.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return guard(async () => {
    const [preparing, completed] = await Promise.all([
      fetchDuelListings({ status: "preparing", limit: 20 }),
      fetchDuelListings({ status: "completed", limit: 20 }),
    ]);
    return ok(
      { available: true, preparing: preparing.listings, completed: completed.listings },
      { sMaxAge: 30, staleWhileRevalidate: 120 }
    );
  });
}
