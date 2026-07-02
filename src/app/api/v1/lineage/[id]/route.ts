import type { NextRequest } from "next/server";
import { ok, badRequest, notFound, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getLineage } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// A pet's bloodline: ancestors (up to genesis), descendants (recursive), the three line analytics
// (climb vs official expectation, trait concentration, estimated value), and counts. Read-only.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const { id } = await props.params;
  const petId = Number(id);
  if (!Number.isInteger(petId) || petId <= 0) return badRequest("Pet id must be a positive integer.");
  return guard(async () => {
    const lineage = await getLineage(petId);
    if (!lineage) return notFound(`No lineage found for Gigling ${petId}.`);
    return ok(lineage, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
