import type { NextRequest } from "next/server";
import { ok, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getRecords } from "@/lib/api/queries";
import type { RecordMode, RecordWindow } from "@/lib/api/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MODES: RecordMode[] = ["raw", "adjusted"];
const WINDOWS: RecordWindow[] = ["all", "weekly", "daily"];

export function OPTIONS() {
  return preflight();
}

// Racing records: fastest finishes per distance from resolved races, raw and
// condition-adjusted, precomputed in the cron. This only reads and paginates.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const trackRaw = sp.get("track");
  const track = trackRaw != null && Number.isFinite(Number(trackRaw)) ? Math.floor(Number(trackRaw)) : null;
  const mode = (MODES.includes(sp.get("mode") as RecordMode) ? sp.get("mode") : "adjusted") as RecordMode;
  const window = (WINDOWS.includes(sp.get("window") as RecordWindow) ? sp.get("window") : "all") as RecordWindow;

  let limit = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  let offset = Number(sp.get("offset") ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(MAX_LIMIT, Math.floor(limit));
  offset = Math.floor(offset);

  return guard(async () => {
    const board = await getRecords(track, mode, window, limit, offset);
    return ok(board, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
