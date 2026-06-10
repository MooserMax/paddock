import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function tableCount(table: string, filter?: { column: string; value: unknown }) {
  let query = db().from(table).select("*", { count: "exact", head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

export async function GET() {
  try {
    const [racesTotal, racesResolved, racesHydrated, pets, entries, sales, syncState, price] =
      await Promise.all([
        tableCount("races"),
        tableCount("races", { column: "resolved", value: true }),
        tableCount("races", { column: "hydrated", value: true }),
        tableCount("pets"),
        tableCount("race_entries"),
        tableCount("sales"),
        db().from("sync_state").select("key, value, updated_at"),
        db().from("eth_price").select("usd, updated_at").eq("id", 1).maybeSingle(),
      ]);

    return NextResponse.json({
      ok: true,
      counts: {
        races: racesTotal,
        racesResolved,
        racesHydrated,
        pets,
        raceEntries: entries,
        sales,
      },
      ethUsd: price.data ? Number(price.data.usd) : null,
      ethPriceUpdatedAt: price.data?.updated_at ?? null,
      sync: Object.fromEntries(
        (syncState.data ?? []).map((row) => [row.key, { value: row.value, updatedAt: row.updated_at }])
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
