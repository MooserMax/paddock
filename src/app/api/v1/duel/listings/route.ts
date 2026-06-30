import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { fetchDuelListings } from "@/lib/duel";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Read-only proxy of the live Gigaverse duel listings (Preparing/Completed feed), server-side
// and cached, so Paddock's duel feed renders the moment real duels post. Empty now (no duels
// yet); returns an empty page gracefully. Never submits a duel.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  return guard(async () => {
    const page = await fetchDuelListings({ cursor });
    return ok({ available: true, ...page }, { sMaxAge: 30, staleWhileRevalidate: 120 });
  });
}
