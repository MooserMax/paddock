import { db } from "../db";
import { setSyncState } from "../syncState";

// Trailing-24h PAID racing volume = entry fees STAKED into paid races in the last 24 hours
// (money IN, not payouts). Derived from already-indexed data, consistent with the all-time
// "Entry-fee volume" stat: per paid entry the fee is its race's entry_fee_wei, so the volume is
// sum(entry_fee_wei x entry_count) over paid races (entry_fee_wei > 0) resolved in the window.
// Free/zero-fee develop races are excluded by the entry_fee_wei > 0 filter. Integer wei; ETH is
// derived for display, USD only at the panel from the live rate. Recomputed each cron tick so
// the trailing window slides (races older than 24h drop out).
//
// Cross-checked against an independent on-chain scan (RACE_JOINED entry-fee transfers to the
// three racing contracts) which gave ~0.062 ETH over the same window. This DB figure uses the
// base entry fee (the on-chain transfer also carries the ~1% juiced protocol surcharge), and
// windows on resolved_at rather than exact join-block time, so it tracks the same magnitude.

export const PAID_VOLUME_KEY = "paid_volume_24h_v1";

export interface PaidVolume24h {
  volumeWei: string;
  volumeEth: string;
  paidRaces: number;
  paidEntries: number;
  windowHours: number;
  generatedAt: string;
}

function weiToEthStr(wei: bigint, dp = 6): string {
  const w = wei < 0n ? -wei : wei;
  return `${wei < 0n ? "-" : ""}${w / 10n ** 18n}.${(w % 10n ** 18n).toString().padStart(18, "0").slice(0, dp)}`;
}

export async function computePaidVolume24h(): Promise<PaidVolume24h> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // Paid races resolved in the last 24h (paginated past the 1000-row cap).
  const races: { race_id: number; entry_fee_wei: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("races")
      .select("race_id, entry_fee_wei")
      .eq("resolved", true)
      .gt("entry_fee_wei", 0)
      .gte("resolved_at", cutoff)
      .order("race_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`paid-volume races read failed: ${error.message}`);
    races.push(...((data ?? []) as { race_id: number; entry_fee_wei: string }[]));
    if (!data || data.length < 1000) break;
  }

  const feeById = new Map(races.map((r) => [r.race_id, BigInt(r.entry_fee_wei)]));
  const raceIds = races.map((r) => r.race_id);

  // Count the actual paid entries per race (one race_entries row per finisher), sliced so the
  // race_id IN-list stays short, paginated so no 1000-row truncation.
  const counts = new Map<number, number>();
  for (let i = 0; i < raceIds.length; i += 300) {
    const slice = raceIds.slice(i, i + 300);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db()
        .from("race_entries")
        .select("race_id")
        .in("race_id", slice)
        .order("race_id", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`paid-volume entries read failed: ${error.message}`);
      for (const r of (data ?? []) as { race_id: number }[]) counts.set(r.race_id, (counts.get(r.race_id) ?? 0) + 1);
      if (!data || data.length < 1000) break;
    }
  }

  let vol = 0n, entries = 0;
  for (const [id, c] of counts) { vol += (feeById.get(id) ?? 0n) * BigInt(c); entries += c; }

  const result: PaidVolume24h = {
    volumeWei: vol.toString(),
    volumeEth: weiToEthStr(vol),
    paidRaces: races.length,
    paidEntries: entries,
    windowHours: 24,
    generatedAt: new Date().toISOString(),
  };
  await setSyncState(PAID_VOLUME_KEY, result);
  return result;
}
