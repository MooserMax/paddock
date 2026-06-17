import type { NextRequest } from "next/server";
import { ok, badRequest, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getLeaderboard } from "@/lib/api/queries";
import type { LeaderboardMetric } from "@/lib/api/types";

export const dynamic = "force-dynamic";

const VALID_METRICS: LeaderboardMetric[] = ["cq", "elo", "winrate", "earnings", "upside"];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const metric = (sp.get("metric") ?? "cq") as LeaderboardMetric;
  if (!VALID_METRICS.includes(metric)) {
    return badRequest(`metric must be one of: ${VALID_METRICS.join(", ")}.`);
  }

  let limit = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  let offset = Number(sp.get("offset") ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(MAX_LIMIT, Math.floor(limit));
  offset = Math.floor(offset);

  return guard(async () => {
    const board = await getLeaderboard(metric, limit, offset);
    return ok(board, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
