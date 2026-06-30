import type { NextRequest } from "next/server";
import { ok, guard, badRequest, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getDuelRadar } from "@/lib/api/queries";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Duel eligibility radar for any address, from Paddock's own indexed pet/race data (no N+1).
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) return badRequest("A valid wallet address is required.");
  return guard(async () => {
    const radar = await getDuelRadar(address);
    return ok(radar, { sMaxAge: 60, staleWhileRevalidate: 300 });
  });
}
