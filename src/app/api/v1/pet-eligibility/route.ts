import type { NextRequest } from "next/server";
import { ok, guard, badRequest, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { getPetEntryCheck } from "@/lib/api/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// Validate a manually typed horse ID for entry: ownership + eligibility + (with
// ?race={id}) the horse's band in that field. Read-only; the entry itself is still
// signed by the user's wallet and still runs the pre-sign simulation gate.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const walletRaw = sp.get("wallet");
  const wallet = walletRaw && /^0x[0-9a-fA-F]{40}$/.test(walletRaw) ? walletRaw : null;
  if (!wallet) return badRequest("A connected wallet is required.");
  const petRaw = sp.get("pet");
  const pet = petRaw != null && Number.isInteger(Number(petRaw)) && Number(petRaw) > 0 ? Number(petRaw) : null;
  if (pet == null) return badRequest("A positive horse id is required.");
  const raceRaw = sp.get("race");
  const race = raceRaw != null && Number.isInteger(Number(raceRaw)) && Number(raceRaw) > 0 ? Number(raceRaw) : null;

  return guard(async () => {
    const check = await getPetEntryCheck(wallet, pet, race);
    return ok(check, { sMaxAge: 2, staleWhileRevalidate: 4 });
  });
}
