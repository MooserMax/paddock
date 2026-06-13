import type { NextRequest } from "next/server";
import { ok, badRequest, notFound, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getPetDossier } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Pet id must be a positive integer.");

  return guard(async () => {
    const dossier = await getPetDossier(id);
    if (!dossier) return notFound(`No Gigling found with id ${id}.`);
    // Dossiers change only when the pet is re-synced (minutes). Cache hard.
    return ok(dossier, { sMaxAge: 120, staleWhileRevalidate: 600 });
  });
}
