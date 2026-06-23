import type { NextRequest } from "next/server";
import { ok, guard, preflight, badRequest, notFound } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getRaceTracking } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Live state for one race the connected wallet is in, for the follow-your-entry
// tracker: phase (1 forming, 2 running, 3 resolved), the field, the user's placing
// and payout once resolved, and Paddock's prediction band for the user's horse. The
// CLIENT polls this every few seconds and stops at phase 3; this handler fetches on
// demand (no server background refresh) and the short s-maxage fans repeat viewers
// of the same race out to one upstream read. Read-only, no signature.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const raceId = Number(params.id);
  if (!Number.isInteger(raceId) || raceId <= 0) return badRequest("race id must be a positive integer");
  const petRaw = req.nextUrl.searchParams.get("pet");
  const pet = petRaw != null && Number.isInteger(Number(petRaw)) && Number(petRaw) > 0 ? Number(petRaw) : null;
  if (pet == null) return badRequest("pet is required");

  return guard(async () => {
    const tracking = await getRaceTracking(raceId, pet);
    if (!tracking) return notFound("race not found or not readable");
    return ok(tracking, { sMaxAge: 3, staleWhileRevalidate: 6 });
  });
}
