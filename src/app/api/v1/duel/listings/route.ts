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

  const sp = req.nextUrl.searchParams;
  const statusRaw = sp.get("status");
  const status = statusRaw === "preparing" || statusRaw === "completed" ? statusRaw : undefined;
  const cursor = sp.get("cursor") ?? undefined;

  return guard(async () => {
    const page = await fetchDuelListings({ status, cursor });
    return ok({ available: true, status: status ?? "all", ...page }, { sMaxAge: 30, staleWhileRevalidate: 120 });
  });
}
