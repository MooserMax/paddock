import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cronAuth";
import { rollingPetSync } from "@/lib/ingest/pets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  try {
    const result = await rollingPetSync({ maxPets: 400, staleMinutes: 30 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
