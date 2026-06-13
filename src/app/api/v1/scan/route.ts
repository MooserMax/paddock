import type { NextRequest } from "next/server";
import { ok, badRequest, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getScan } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

const TRACKS = [500, 1200, 2400, 3000];
const MAX_FIELD = 12;

export function OPTIONS() {
  return preflight();
}

// Live-lobby scan: ?pets=1,2,3&track=1200&mark=2 -> a verdict for an ad-hoc field
// that is not a stored race. Read-only, computed from our DB.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const petIds = (sp.get("pets") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (petIds.length < 2) return badRequest("Provide at least 2 pet ids, e.g. ?pets=6249,3010.");
  if (petIds.length > MAX_FIELD) return badRequest(`A field is at most ${MAX_FIELD} horses.`);

  const track = Number(sp.get("track") ?? 1200);
  if (!TRACKS.includes(track)) return badRequest(`track must be one of: ${TRACKS.join(", ")}.`);

  const markParam = sp.get("mark");
  const mark = markParam ? Number(markParam) : undefined;
  if (markParam && !petIds.includes(mark!)) return badRequest("mark must be one of the provided pet ids.");

  return guard(async () => {
    const scan = await getScan(petIds, track, mark);
    // Live-lobby scans reflect the current field; cache briefly only.
    return ok(scan, { sMaxAge: 15, staleWhileRevalidate: 30 });
  });
}
