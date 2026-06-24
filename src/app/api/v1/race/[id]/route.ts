import type { NextRequest } from "next/server";
import { ok, badRequest, notFound, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getRaceDetail } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = rateLimit(req);
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Race id must be a positive integer.");

  // Optional ?mark=<petId> to compute the YOUR FIT verdict for one horse.
  const markParam = req.nextUrl.searchParams.get("mark");
  const markedPetId = markParam ? Number(markParam) : undefined;
  if (markParam && (!Number.isInteger(markedPetId!) || markedPetId! <= 0)) {
    return badRequest("mark must be a positive pet id.");
  }

  return guard(async () => {
    const race = await getRaceDetail(id, markedPetId);
    if (!race) return notFound(`No race found with id ${id}.`);
    // Resolved races are immutable; cache them very hard. Open races less so.
    const sMaxAge = race.resolved ? 3600 : 30;
    return ok(race, { sMaxAge, staleWhileRevalidate: sMaxAge * 4 });
  });
}
