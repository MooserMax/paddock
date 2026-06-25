import type { NextRequest } from "next/server";
import { ok, badRequest, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getWalletSummary } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest, props: { params: Promise<{ address: string }> }) {
  const params = await props.params;
  const limited = rateLimit(req);
  if (limited) return limited;

  const input = decodeURIComponent(params.address ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(input)) {
    // Gigaverse-name resolution is a follow-up; the address flow is the
    // provable, zero-live-call path. Be explicit rather than silently empty.
    return badRequest("Provide a wallet address (0x + 40 hex). Gigaverse-name lookup is coming.");
  }

  return guard(async () => {
    const summary = await getWalletSummary(input);
    // Shorter edge cache so a just-resolved race's updated stats are not served stale
    // for minutes. The client also polls and refetches on focus; this bounds the CDN
    // contribution to staleness to ~90s while still fanning repeat viewers out.
    return ok(summary, { sMaxAge: 30, staleWhileRevalidate: 60 });
  });
}
