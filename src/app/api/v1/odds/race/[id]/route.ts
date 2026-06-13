import type { NextRequest } from "next/server";
import { ok, badRequest, notFound, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getOdds } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Race id must be a positive integer.");

  return guard(async () => {
    const odds = await getOdds(id);
    if (!odds) return notFound(`No race found with id ${id}.`);
    return ok(odds, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
