import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { findMyRaceId } from "@/lib/api/queries";
import type { MyRaceDTO } from "@/lib/api/types";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Discovery for the follow-your-entry view. Given ?wallet, returns the most recent
// race the wallet's pets are in, found from RACE_JOINED logs on the Abstract RPC.
// Read-only, no signature.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const walletRaw = req.nextUrl.searchParams.get("wallet");
  const wallet = walletRaw && /^0x[0-9a-fA-F]{40}$/.test(walletRaw) ? walletRaw : null;
  if (!wallet) {
    const empty: MyRaceDTO = { raceId: null, petId: null };
    return ok(empty, { sMaxAge: 5, staleWhileRevalidate: 10 });
  }

  return guard(async () => {
    const found = await findMyRaceId(wallet);
    const body: MyRaceDTO = { raceId: found.raceId, petId: found.petId };
    return ok(body, { sMaxAge: 5, staleWhileRevalidate: 10 });
  });
}
