import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lightweight liveness endpoint for external monitors that ping frequently. It
// does NOT run the full /stats aggregation: just a single cheap, head-only count
// against a one-row table, bounded by a short timeout and fail-soft. A slow or
// unreachable DB reports status "degraded" with HTTP 200 (so a monitor sees the
// service is up but flags the dependency), never a hang or a 500.
const DB_PING_TIMEOUT_MS = 2000;

const HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

async function pingDb(): Promise<boolean> {
  // head:true sends no rows back; eth_price holds a single PK-indexed row, so
  // this is about as cheap as a query gets.
  const probe = db().from("eth_price").select("id", { count: "exact", head: true }).then(({ error }) => !error);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DB_PING_TIMEOUT_MS));
  return Promise.race([probe, timeout]).catch(() => false);
}

export async function GET() {
  const dbOk = await pingDb();
  return NextResponse.json(
    {
      status: dbOk ? "ok" : "degraded",
      version: "v1",
      time: new Date().toISOString(),
      db: dbOk,
    },
    { headers: HEADERS }
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
