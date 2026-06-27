import type { NextRequest } from "next/server";
import { ok, badRequest, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { fetchRaceTelemetry, TelemetryUnavailable } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = rateLimit(req);
  if (limited) return limited;

  const raceId = Number(params.id);
  if (!Number.isInteger(raceId) || raceId <= 0) return badRequest("Provide a numeric race id.");

  return guard(async () => {
    let data;
    try {
      data = await fetchRaceTelemetry(raceId);
    } catch (e) {
      if (e instanceof TelemetryUnavailable) {
        return ok({ available: false, reason: e.message }, { sMaxAge: 5, staleWhileRevalidate: 10 });
      }
      throw e;
    }
    // A resolved race is immutable: cache it hard at the edge. A live race stays short.
    return data.finished
      ? ok(data, { sMaxAge: 86400, staleWhileRevalidate: 604800 })
      : ok(data, { sMaxAge: 5, staleWhileRevalidate: 15 });
  });
}
