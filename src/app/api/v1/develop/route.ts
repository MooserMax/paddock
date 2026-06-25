import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getDevelop } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Develop Mode data, read-only. With ?wallet={address} it returns the wallet's
// horses ranked by development need (least revealed first) with their eligibility,
// plus the open FREE races available to enter. No signature; the actual batched
// entry is signed client-side by the user's own wallet.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const walletRaw = req.nextUrl.searchParams.get("wallet");
  const wallet = walletRaw && /^0x[0-9a-fA-F]{40}$/.test(walletRaw) ? walletRaw : null;

  return guard(async () => {
    const board = await getDevelop(wallet);
    return ok(board, { sMaxAge: 3, staleWhileRevalidate: 6 });
  });
}
