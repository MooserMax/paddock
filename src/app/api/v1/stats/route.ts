import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getSiteStats } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return guard(async () => {
    const stats = await getSiteStats();
    return ok(stats, { sMaxAge: 60, staleWhileRevalidate: 300 });
  });
}
