import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getLobbies } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Live forming lobbies, read-only. With ?wallet={address} or ?pet={id} each lobby
// also carries the user's win probability, EV, and recommended horse. The server
// cache fans one upstream poll out to all viewers; the short s-maxage lets the CDN
// absorb bursts too. Honest, live, may lag a few seconds.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const walletRaw = sp.get("wallet");
  const wallet = walletRaw && /^0x[0-9a-fA-F]{40}$/.test(walletRaw) ? walletRaw : null;
  const petRaw = sp.get("pet");
  const pet = petRaw != null && Number.isInteger(Number(petRaw)) && Number(petRaw) > 0 ? Number(petRaw) : null;

  return guard(async () => {
    const board = await getLobbies(wallet, pet);
    // Short edge cache matched to the live snapshot cadence; the server cache and
    // CDN both absorb the client poll so upstream stays polite.
    return ok(board, { sMaxAge: 3, staleWhileRevalidate: 6 });
  });
}
