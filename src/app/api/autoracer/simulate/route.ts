import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { buildJoinRaceTx } from "@/lib/autoracer/build";
import { dryRunJoinRace } from "@/lib/autoracer/simulate";

export const dynamic = "force-dynamic";

// ISOLATED from /api/v1 on purpose. The public API exposes read-only intelligence;
// this is the signing path's dry-run. The two worlds never mix. This endpoint
// still signs nothing: it builds a joinRace, runs the safety guard, and does a
// read-only eth_call.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const raceId = Number(sp.get("race"));
  const petId = Number(sp.get("pet"));
  if (!Number.isInteger(raceId) || raceId <= 0 || !Number.isInteger(petId) || petId <= 0) {
    return NextResponse.json({ error: { code: "bad_request", message: "Provide ?race= and ?pet= as positive integers." } }, { status: 400 });
  }

  try {
    const tx = buildJoinRaceTx(raceId, petId);
    const from = sp.get("from") ?? undefined;
    const result = await dryRunJoinRace(tx, from || undefined);
    return NextResponse.json({ ...result, signed: false, note: "Simulation only. Nothing was signed or broadcast." }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "simulation failed";
    return NextResponse.json({ error: { code: "server_error", message } }, { status: 500 });
  }
}
