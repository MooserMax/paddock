import type { NextRequest } from "next/server";
import { ok, notFound, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getCalibration } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Precomputed by scripts/backtest-odds.mjs and read here. Never computed on
// request: the ~5,150-race backtest is a materialized job, not a page load.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return guard(async () => {
    const calibration = await getCalibration();
    if (!calibration) return notFound("Calibration has not been computed yet.");
    return ok(calibration, { sMaxAge: 600, staleWhileRevalidate: 3600 });
  });
}
