import type { NextRequest } from "next/server";
import { ok, guard, preflight, notFound } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getDuelTraining } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// The labeled resolved-duel training set (Part 1): every RESOLVED duel as a compact row, plus the
// aggregate outcomes and the model's backtest accuracy. This is what the teaching feed and the
// model-accuracy tile render from, served from our stored fit (no live per-request pipeline).
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  return guard(async () => {
    const t = await getDuelTraining();
    if (!t) return notFound("The duel training set has not been fit yet.");
    return ok(t, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
