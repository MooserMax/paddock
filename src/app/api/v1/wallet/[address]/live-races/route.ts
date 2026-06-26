import type { NextRequest } from "next/server";
import { ok, badRequest, guard, preflight } from "@/lib/api/http";
import { rateLimit } from "@/lib/api/rateLimit";
import { findMyJoinedRaces } from "@/lib/raceTracker";
import { db } from "@/lib/db";
import type { LiveRaceItem } from "@/lib/api/types";

export const dynamic = "force-dynamic";

// Races resolve in minutes, so the client polls this on a short cadence. A short edge
// cache coalesces concurrent polls without hurting near-live freshness.
const POLL_MS = 20_000;

export function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest, props: { params: Promise<{ address: string }> }) {
  const params = await props.params;
  const limited = rateLimit(req);
  if (limited) return limited;

  const input = decodeURIComponent(params.address ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(input)) {
    return badRequest("Provide a wallet address (0x + 40 hex).");
  }

  return guard(async () => {
    // 1. The wallet's recent joins from one bounded, topic-filtered on-chain log read.
    const { races: joins, head, windowBlocks } = await findMyJoinedRaces(input);

    // Aggregate joins by race: the wallet's pet(s) and the most recent join block.
    const byRace = new Map<number, { petIds: Set<number>; block: number }>();
    for (const j of joins) {
      const cur = byRace.get(j.raceId) ?? { petIds: new Set<number>(), block: 0 };
      cur.petIds.add(j.petId);
      cur.block = Math.max(cur.block, j.block);
      byRace.set(j.raceId, cur);
    }
    const raceIds = [...byRace.keys()];

    // 2. Resolved cross-out from Paddock's own ingest (cheap DB read): a joined race is
    //    FINISHED once we have it as resolved, otherwise it is still LIVE/pending.
    const resolved = new Map<number, { finished: boolean; track: number | null; resolvedAt: string | null }>();
    if (raceIds.length) {
      const { data } = await db()
        .from("races")
        .select("race_id, resolved, track_length, resolved_at")
        .in("race_id", raceIds);
      for (const r of data ?? []) {
        resolved.set(r.race_id as number, {
          finished: r.resolved === true,
          track: (r.track_length as number | null) ?? null,
          resolvedAt: (r.resolved_at as string | null) ?? null,
        });
      }
    }

    // 3. Build rows. State derives entirely from logs + resolved DB, nothing fabricated.
    const rows: (LiveRaceItem & { block: number })[] = [];
    for (const [raceId, agg] of byRace) {
      const res = resolved.get(raceId);
      const finished = res?.finished === true;
      rows.push({
        raceId,
        petIds: [...agg.petIds].sort((a, b) => a - b),
        status: finished ? "finished" : "live",
        trackLength: res?.track ?? null,
        resolvedAt: res?.resolvedAt ?? null,
        block: agg.block,
      });
    }
    // Live first (newest join), then finished (newest resolved). Bounded list.
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === "live" ? -1 : 1;
      if (a.status === "live") return b.block - a.block;
      return (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "");
    });
    const races: LiveRaceItem[] = rows.slice(0, 12).map(({ block, ...rest }) => { void block; return rest; });

    return ok(
      { wallet: input.toLowerCase(), races, headBlock: head, windowBlocks, pollMs: POLL_MS, meta: { source: "onchain-joins + paddock-db" } },
      { sMaxAge: 10, staleWhileRevalidate: 20 }
    );
  });
}
