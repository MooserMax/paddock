import { db } from "../db";
import { env } from "../env";
import { getSyncState, setSyncState } from "../syncState";

const COLLECTION = "gigaverse-giglings";
const STATE_KEY = "opensea_sales";
const MAX_PAGES = 10;

interface SalesState {
  lastEventTs: number;
}

interface OpenSeaPayment {
  quantity: string;
  decimals: number;
  symbol: string;
}

interface OpenSeaEvent {
  event_type: string;
  event_timestamp: number;
  transaction: string;
  nft: { identifier: string } | null;
  payment: OpenSeaPayment | null;
}

interface OpenSeaEventsResponse {
  asset_events: OpenSeaEvent[];
  next: string | null;
}

async function fetchSalesPage(next: string | null): Promise<OpenSeaEventsResponse> {
  const url = new URL(`https://api.opensea.io/api/v2/events/collection/${COLLECTION}`);
  url.searchParams.set("event_type", "sale");
  url.searchParams.set("limit", "50");
  if (next) url.searchParams.set("next", next);

  const res = await fetch(url, {
    headers: { accept: "application/json", "x-api-key": env("OPENSEA_API_KEY") },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenSea API ${res.status}`);
  return (await res.json()) as OpenSeaEventsResponse;
}

export interface SalesSyncResult {
  pages: number;
  inserted: number;
}

// Pull recent gigaverse-giglings sales, newest first, stopping once we reach
// events we have already stored. Only ETH/WETH-denominated sales are priced.
export async function syncSales(): Promise<SalesSyncResult> {
  const state = await getSyncState<SalesState>(STATE_KEY);
  const lastSeenTs = state?.lastEventTs ?? 0;

  const { data: priceRow } = await db().from("eth_price").select("usd").eq("id", 1).maybeSingle();
  const ethUsd = priceRow ? Number(priceRow.usd) : null;

  let cursor: string | null = null;
  let pages = 0;
  let inserted = 0;
  let newestTs = lastSeenTs;
  let reachedKnown = false;

  while (pages < MAX_PAGES && !reachedKnown) {
    const page = await fetchSalesPage(cursor);
    pages += 1;

    const rows = [];
    for (const event of page.asset_events) {
      if (event.event_timestamp <= lastSeenTs) {
        reachedKnown = true;
        continue;
      }
      newestTs = Math.max(newestTs, event.event_timestamp);
      if (!event.nft || !event.payment) continue;
      const isEth = event.payment.symbol === "ETH" || event.payment.symbol === "WETH";
      const priceEth = isEth
        ? Number(event.payment.quantity) / 10 ** event.payment.decimals
        : null;
      rows.push({
        tx_hash: event.transaction,
        token_id: Number(event.nft.identifier),
        price_eth: priceEth,
        price_usd: priceEth !== null && ethUsd !== null ? priceEth * ethUsd : null,
        sold_at: new Date(event.event_timestamp * 1000).toISOString(),
        marketplace: "opensea",
      });
    }

    if (rows.length > 0) {
      const { error } = await db()
        .from("sales")
        .upsert(rows, { onConflict: "tx_hash,token_id", ignoreDuplicates: true });
      if (error) throw new Error(`sales upsert failed: ${error.message}`);
      inserted += rows.length;
    }

    cursor = page.next;
    if (!cursor || page.asset_events.length === 0) break;
  }

  if (newestTs > lastSeenTs) {
    await setSyncState(STATE_KEY, { lastEventTs: newestTs } satisfies SalesState);
  }
  return { pages, inserted };
}
