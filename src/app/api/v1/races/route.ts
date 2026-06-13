import type { NextRequest } from "next/server";
import { ok, badRequest, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getRecentRaces } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

const TRACKS = [500, 1200, 2400, 3000];
const MAX_LIMIT = 50;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const trackParam = sp.get("track");
  const track = trackParam ? Number(trackParam) : null;
  if (trackParam && !TRACKS.includes(track!)) {
    return badRequest(`track must be one of: ${TRACKS.join(", ")}.`);
  }
  let limit = Number(sp.get("limit") ?? 24);
  let offset = Number(sp.get("offset") ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) limit = 24;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(MAX_LIMIT, Math.floor(limit));
  offset = Math.floor(offset);

  return guard(async () => {
    const result = await getRecentRaces(track, limit, offset);
    return ok(result, { sMaxAge: 30, staleWhileRevalidate: 120 });
  });
}
