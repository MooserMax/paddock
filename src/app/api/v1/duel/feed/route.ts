import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { fetchDuelFeed } from "@/lib/duel";

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
    // The API's status= param is a no-op; partition by on-chain phase ourselves (RESOLVED =
    // completed, OPEN/READY = preparing), deduplicated across pages.
    const feed = await fetchDuelFeed(3);
    return ok(
      { available: true, preparing: feed.preparing, completed: feed.completed },
      { sMaxAge: 30, staleWhileRevalidate: 120 }
    );
  });
}
