import { getSyncState, setSyncState } from "./syncState";

// Cached daily ETH/USD close series, so historical-price valuation (each buy at its own day's
// price) is computed from real history, once, not per request. Source: Coinbase Exchange daily
// candles (https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400), public,
// no key, <=300 candles/request (chunked). Refreshed at most ~daily; immutable history is reused.

const KEY = "eth_price_daily_v1";
const START_TS = Date.UTC(2025, 3, 20) / 1000; // a bit before the first Juice buy (2025-05-01)
const STEP = 280 * 86_400; // <= 300 candles/request

interface CacheShape { days: Record<string, number>; updatedAt: string }
const dayStr = (tsSec: number) => new Date(tsSec * 1000).toISOString().slice(0, 10);

async function fetchCoinbaseDaily(existing: Record<string, number>): Promise<Record<string, number>> {
  const days = { ...existing };
  const end = Math.floor(Date.now() / 1000);
  for (let s = START_TS; s < end; s += STEP) {
    const e = Math.min(s + STEP, end);
    const url = `https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (res.ok) {
        const rows = (await res.json()) as number[][]; // [time, low, high, open, close, volume]
        if (Array.isArray(rows)) for (const c of rows) if (Array.isArray(c) && c[4] > 0) days[dayStr(c[0])] = c[4];
      }
    } catch { /* keep whatever we have; a partial series still values most buys */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return days;
}

// Returns the day->close map, refreshing from Coinbase only when the cache does not yet reach
// yesterday (so the immutable history is fetched once and only the tail is topped up ~daily).
export async function getDailyEthUsd(): Promise<Record<string, number>> {
  const cached = await getSyncState<CacheShape>(KEY);
  const yesterday = dayStr(Math.floor(Date.now() / 1000) - 86_400);
  const last = cached ? Object.keys(cached.days).sort().pop() : null;
  if (cached && last && last >= yesterday) return cached.days;
  const days = await fetchCoinbaseDaily(cached?.days ?? {});
  await setSyncState(KEY, { days, updatedAt: new Date().toISOString() } satisfies CacheShape);
  return days;
}

// ETH/USD for a given YYYY-MM-DD, with nearest-day fallback when a day is missing (weekend gaps,
// outages). Returns null only if the series is empty.
export function priceOnDay(days: Record<string, number>, sortedKeys: string[], date: string): number | null {
  if (days[date]) return days[date];
  if (sortedKeys.length === 0) return null;
  let best: string | null = null, bestDiff = Infinity;
  const target = Date.parse(date);
  for (const k of sortedKeys) { const diff = Math.abs(Date.parse(k) - target); if (diff < bestDiff) { bestDiff = diff; best = k; } }
  return best ? days[best] : null;
}
