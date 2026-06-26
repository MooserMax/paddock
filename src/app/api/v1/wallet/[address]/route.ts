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

  // Manual refresh: force a fresh, wallet-scoped re-read from upstream and bypass the
  // CDN entirely so the caller gets the just-synced state (and an advanced asOf), not
  // a cached copy. Read-only: re-syncs and re-scores this wallet's pets, no signature,
  // no chain write. The client also adds a cache-buster and rate-limits its clicks.
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  return guard(async () => {
    const summary = await getWalletSummary(input, { refresh });
    if (refresh) return ok(summary, { extraHeaders: { "Cache-Control": "no-store" } });
    // Shorter edge cache so a just-resolved race's updated stats are not served stale
    // for minutes. The client also polls and refetches on focus; this bounds the CDN
    // contribution to staleness to ~90s while still fanning repeat viewers out.
    return ok(summary, { sMaxAge: 30, staleWhileRevalidate: 60 });
  });
}
