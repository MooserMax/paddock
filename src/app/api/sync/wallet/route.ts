import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncPetIds } from "@/lib/ingest/pets";
import { getSyncState, setSyncState } from "@/lib/syncState";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const COOLDOWN_MS = 5 * 60_000;
const MAX_PETS_PER_WALLET = 200;

// On-demand polite refresh of one wallet's pets, used by the wallet lookup
// flow when our copy is stale. Rate limited per wallet via sync_state.
export async function POST(req: NextRequest) {
  let address: string;
  try {
    const body = (await req.json()) as { address?: string };
    address = (body.address ?? "").toLowerCase().trim();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid address" }, { status: 400 });
  }

  try {
    const stateKey = `wallet_sync:${address}`;
    const last = await getSyncState<{ at: number }>(stateKey);
    if (last && Date.now() - last.at < COOLDOWN_MS) {
      return NextResponse.json({ ok: true, skipped: "cooldown", lastSyncedAt: last.at });
    }

    const { data, error } = await db()
      .from("pets")
      .select("id")
      .eq("owner_address", address)
      .limit(MAX_PETS_PER_WALLET);
    if (error) throw new Error(`wallet pets query failed: ${error.message}`);

    const ids = (data ?? []).map((row) => row.id as number);
    const synced = await syncPetIds(ids);
    await setSyncState(stateKey, { at: Date.now() });
    return NextResponse.json({ ok: true, requested: ids.length, synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
