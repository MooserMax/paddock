import { db } from "../db";
import { getSyncState, setSyncState } from "../syncState";
import { latestBlock } from "../chain";
import {
  ITEM_MARKET_DEPLOY_BLOCK,
  TOPIC_LISTING_CREATED,
  TOPIC_TRANSFER_FROM_LISTING,
  fetchItemLogs,
  decodeListing,
  decodePurchase,
  blockTimestamp,
} from "../itemMarket";

// On-chain item-spend pipeline. The chain is the source of truth: ListingCreated populates
// a price map (item_listings), TransferFromListing rows are the purchases, and
// spend_wei = pricePerItem(listing) x quantity, ALL in integer wei. A purchase row is keyed
// (tx_hash, log_index) so any re-run upserts zero duplicates. Spend is NATIVE ETH (18 dec);
// wei is converted to ETH only at the serialization boundary, preserving small magnitudes.
//
// Aggregates (item-stats + top-spender leaderboard) are materialized into sync_state by the
// cron so the public endpoints read precomputed JSON and never touch the chain at request time.

const CURSOR_KEY = "item_spend_scan";       // { lastBlock } -- contiguous deploy->here is indexed
const BACKFILL_KEY = "item_spend_backfill";  // { nextBlock } -- resumable full backfill progress
export const ITEM_STATS_KEY = "item_stats_v1";
export const ITEM_LEADERBOARD_KEY = "item_leaderboard_v1";

const CHUNK = 9000n; // <= 9k blocks per getLogs; fetchItemLogs halves further on the 10k cap

// Racing consumables ONLY: the dung (drag/slow) and butterfly (speed boost) items pets produce
// and use in races, plus all 8 faction variants of each. Resolved by NAME from the public
// Gigaverse items catalog (GET /api/indexer/gameitems, docId -> NAME_CID), cross-checked against
// the race scheduledItems usage seed. Deliberately EXCLUDES name-substring false positives such
// as itemId 2 "Dungeon Scrap" and itemId 615 "Chum" (not a consumable, high-volume but unrelated).
// The dashboard "item spend" must reflect only these; the whole-marketplace total is not it.
export const CONSUMABLE_NAMES: Record<number, string> = {
  607: "Dung", 608: "Crusader Dung", 609: "Overseer Dung", 610: "Athena Dung", 611: "Archon Dung",
  612: "Foxglove Dung", 613: "Summoner Dung", 614: "Chobo Dung", 624: "Gigus Dung",
  603: "Butterfly", 593: "Crusader Butterfly", 594: "Overseer Butterfly", 595: "Athena Butterfly",
  596: "Archon Butterfly", 597: "Foxglove Butterfly", 598: "Summoner Butterfly", 599: "Chobo Butterfly", 623: "Gigus Butterfly",
};
export const DUNG_ITEM_IDS = [607, 608, 609, 610, 611, 612, 613, 614, 624];
export const BUTTERFLY_ITEM_IDS = [593, 594, 595, 596, 597, 598, 599, 603, 623];
const DUNG_SET = new Set(DUNG_ITEM_IDS);
const BUTTERFLY_SET = new Set(BUTTERFLY_ITEM_IDS);
const CONSUMABLE_SET = new Set([...DUNG_ITEM_IDS, ...BUTTERFLY_ITEM_IDS]);

// PostgREST caps a SELECT at 1000 rows. Aggregation must read EVERY row, so page through with
// a stable, unique ordering (else page boundaries drop or duplicate rows). Without this the
// totals silently reflect only the first 1000 purchases.
async function readAllRows<T = Record<string, unknown>>(table: string, columns: string, orderCols: string[]): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db().from(table).select(columns).range(from, from + PAGE - 1);
    for (const c of orderCols) q = q.order(c, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`${table} paged read failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface ListingPrice { price: bigint; itemId: number }

// Load prices for the referenced listings from the DB. A purchase's listing was always
// created in an earlier (or the same) block, so in a contiguous backfill it is already
// stored; only purchases whose listing predates the indexed range stay unpriced.
async function loadListingPrices(listingIds: number[]): Promise<Map<number, ListingPrice>> {
  const map = new Map<number, ListingPrice>();
  for (let i = 0; i < listingIds.length; i += 500) {
    const slice = listingIds.slice(i, i + 500);
    const { data, error } = await db()
      .from("item_listings")
      .select("listing_id, item_id, price_per_item_wei")
      .in("listing_id", slice);
    if (error) throw new Error(`item_listings read failed: ${error.message}`);
    for (const r of data ?? []) map.set(Number(r.listing_id), { price: BigInt(r.price_per_item_wei), itemId: Number(r.item_id) });
  }
  return map;
}

export interface IndexResult {
  fromBlock: number;
  lastProcessed: number;
  done: boolean;
  listings: number;
  purchases: number;
  priced: number;
}

// Index both events over [from,to] in ascending chunks, upserting listings then purchases.
// Stops early (resumable) when budgetMs is exhausted, returning the last fully-processed block.
export async function indexItemSpend(from: bigint, to: bigint, budgetMs: number): Promise<IndexResult> {
  const deadline = Date.now() + budgetMs;
  let listings = 0, purchases = 0, priced = 0;
  let lastProcessed = from - 1n;

  for (let cur = from; cur <= to; cur += CHUNK) {
    const end = cur + CHUNK - 1n > to ? to : cur + CHUNK - 1n;

    const listingLogs = await fetchItemLogs(TOPIC_LISTING_CREATED, cur, end);
    if (listingLogs.length) {
      const rows = listingLogs.map(decodeListing).map((l) => ({
        listing_id: l.listingId,
        item_id: l.itemId,
        amount: l.amount,
        price_per_item_wei: l.pricePerItemWei.toString(),
        owner: l.owner,
        block_number: l.blockNumber,
      }));
      const { error } = await db().from("item_listings").upsert(rows, { onConflict: "listing_id" });
      if (error) throw new Error(`item_listings upsert failed: ${error.message}`);
      listings += rows.length;
    }

    const purchaseLogs = await fetchItemLogs(TOPIC_TRANSFER_FROM_LISTING, cur, end);
    if (purchaseLogs.length) {
      const decoded = purchaseLogs.map(decodePurchase);
      const priceMap = await loadListingPrices([...new Set(decoded.map((p) => p.listingId))]);
      const rows = decoded.map((p) => {
        const L = priceMap.get(p.listingId);
        const spend = L ? L.price * BigInt(p.quantity) : null; // integer wei
        if (L) priced++;
        return {
          tx_hash: p.txHash,
          log_index: p.logIndex,
          transfer_id: p.transferId,
          listing_id: p.listingId,
          item_id: L ? L.itemId : null,
          buyer: p.buyer, // transferredTo, never the seller
          quantity: p.quantity,
          price_per_item_wei: L ? L.price.toString() : null,
          spend_wei: spend != null ? spend.toString() : null,
          block_number: p.blockNumber,
          // ts is derived from block height at materialization time (see the 7d window), so we
          // do not pay a per-block eth_getBlockByNumber RPC during indexing (keeps cron < 60s).
        };
      });
      const { error } = await db().from("item_purchases").upsert(rows, { onConflict: "tx_hash,log_index" });
      if (error) throw new Error(`item_purchases upsert failed: ${error.message}`);
      purchases += rows.length;
    }

    lastProcessed = end;
    if (Date.now() > deadline) break;
  }

  return { fromBlock: Number(from), lastProcessed: Number(lastProcessed), done: lastProcessed >= to, listings, purchases, priced };
}

// Resolve buyer wallet -> primaryUsername (cached in item_accounts). Bounded per run; cached
// addresses are skipped, so steady state resolves only newly-seen buyers. Resolved with a
// small concurrency pool so a run stays well under the 60s response budget.
async function fetchUsername(address: string): Promise<string | null> {
  try {
    const res = await fetch(`https://gigaverse.io/api/account/${address}`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { primaryUsername?: string | null };
    return body.primaryUsername || null;
  } catch {
    return null; // cached as null so we do not refetch it every run
  }
}

export async function resolveBuyerUsernames(limit = 200, concurrency = 6): Promise<number> {
  const buyerRows = await readAllRows<{ buyer: string }>("item_purchases", "buyer", ["block_number", "log_index"]);
  const uniq = [...new Set(buyerRows.map((b) => b.buyer))];
  const known = await readAllRows<{ address: string }>("item_accounts", "address", ["address"]);
  const knownSet = new Set(known.map((k) => k.address));
  const todo = uniq.filter((a) => !knownSet.has(a)).slice(0, limit);

  let next = 0, resolved = 0;
  const now = new Date().toISOString();
  async function worker() {
    while (next < todo.length) {
      const address = todo[next++];
      const username = await fetchUsername(address);
      await db().from("item_accounts").upsert({ address, username, resolved_at: now });
      resolved++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return resolved;
}

// Exact integer-wei -> fixed-decimal ETH string. Never floats away a tiny magnitude.
export function weiToEthString(wei: bigint, dp = 7): string {
  const w = wei < 0n ? -wei : wei;
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, dp);
  return `${wei < 0n ? "-" : ""}${whole}.${frac}`;
}

interface SpendSplit { spendWei: string; spendEth: string; itemsBought: number }
interface NamedItemRow { itemId: number; name: string; spendWei: string; spendEth: string; quantity: number }

// ALL headline figures here are RACING CONSUMABLES ONLY (dung + butterfly). The whole-market
// total is retained under `allItems` for reference but is never the dashboard "item spend".
export interface ItemStatsAgg {
  totalSpendWei: string;   // dung + butterfly combined
  totalSpendEth: string;
  itemsBought: number;
  // uniqueBuyers = distinct buyers among PRICED consumable purchases (spenders with a measured
  // ETH amount). uniqueBuyersAll = distinct buyers across ALL consumable purchases incl. any
  // still-unpriced. After the full backfill these converge.
  uniqueBuyers: number;
  uniqueBuyersAll: number;
  pricedPurchases: number;
  unpricedPurchases: number;
  dung: SpendSplit;
  butterfly: SpendSplit;
  byItem: NamedItemRow[]; // consumables only, named
  window7d: { spendWei: string; spendEth: string; itemsBought: number; purchases: number };
  allItems: { spendWei: string; spendEth: string; itemsBought: number; pricedPurchases: number }; // whole market, reference only
  generatedAt: string;
  lastIndexedBlock: number | null;
  headBlock: number | null;
  // True once the deploy->latest backfill has reached head (cursor set). Until then the numbers
  // cover only an indexed sub-range and must not be presented as "all time".
  complete: boolean;
}

export interface ItemLeaderboardAgg {
  spenders: {
    rank: number;
    address: string;
    username: string | null;
    totalSpendWei: string; // consumable spend only
    totalSpendEth: string;
    itemsBought: number;
    byItem: NamedItemRow[]; // consumables only, named
  }[];
  uniqueBuyers: number; // distinct consumable spenders (priced)
  complete: boolean;    // deploy->latest backfill has reached head
  generatedAt: string;
}

// Aggregate all priced purchases (integer wei) into the two materialized snapshots and store
// them in sync_state. Small data (purchases are sparse); BigInt sums throughout.
export async function materializeItemAggregates(): Promise<{ stats: ItemStatsAgg; leaderboard: ItemLeaderboardAgg }> {
  const rows = await readAllRows<{ item_id: number | null; buyer: string; quantity: number; spend_wei: string | null; block_number: number }>(
    "item_purchases",
    "item_id, buyer, quantity, spend_wei, block_number",
    ["block_number", "log_index"]
  );

  const accs = await readAllRows<{ address: string; username: string | null }>("item_accounts", "address, username", ["address"]);
  const nameMap = new Map(accs.map((a) => [a.address, a.username ?? null]));

  const cursor = await getSyncState<{ lastBlock: string }>(CURSOR_KEY);

  // 7d window by block height, not per-row timestamps: estimate seconds-per-block from two
  // sample blocks (2 RPC calls total) and convert one week into a block-count cutoff. This
  // avoids an eth_getBlockByNumber per purchase during indexing. If the estimate fails, the
  // 7d window is left empty rather than reported wrong.
  const head = Number(await latestBlock());
  const refNum = Math.max(Number(ITEM_MARKET_DEPLOY_BLOCK), head - 200_000);
  const [tHead, tRef] = await Promise.all([blockTimestamp(head), blockTimestamp(refNum)]);
  let cutoffBlock = -1;
  if (tHead && tRef && tHead > tRef && head > refNum) {
    const secPerBlock = (tHead - tRef) / (head - refNum);
    cutoffBlock = head - Math.round(604_800 / secPerBlock);
  }

  // Headline aggregates are CONSUMABLES ONLY (dung + butterfly). allItems is the whole-market
  // reference. A purchase contributes to consumable spend iff its item_id is a dung/butterfly id.
  let total = 0n, items = 0, priced = 0, unpriced = 0;
  let dungWei = 0n, dungItems = 0, buttWei = 0n, buttItems = 0;
  let total7 = 0n, items7 = 0, purch7 = 0;
  let allWei = 0n, allItemsCount = 0, allPriced = 0;
  const buyers = new Set<string>();      // priced consumable buyers (spenders)
  const allBuyers = new Set<string>();   // every distinct consumable buyer, priced or not
  const byItem = new Map<number, { spend: bigint; qty: number }>();
  const byBuyer = new Map<string, { spend: bigint; items: number; byItem: Map<number, { spend: bigint; qty: number }> }>();

  for (const r of rows) {
    const itemId = Number(r.item_id);
    const isConsumable = CONSUMABLE_SET.has(itemId);
    if (r.spend_wei != null) { allWei += BigInt(r.spend_wei as string); allItemsCount += Number(r.quantity); allPriced++; } // whole-market reference
    if (!isConsumable) continue;

    allBuyers.add(r.buyer);
    if (r.spend_wei == null) { unpriced++; continue; } // unpriced consumable rows are not spend
    const s = BigInt(r.spend_wei as string);
    const qty = Number(r.quantity);
    const buyer = r.buyer as string;
    total += s; items += qty; priced++; buyers.add(buyer);
    if (DUNG_SET.has(itemId)) { dungWei += s; dungItems += qty; }
    else if (BUTTERFLY_SET.has(itemId)) { buttWei += s; buttItems += qty; }

    const it = byItem.get(itemId) ?? { spend: 0n, qty: 0 };
    it.spend += s; it.qty += qty; byItem.set(itemId, it);

    const bb = byBuyer.get(buyer) ?? { spend: 0n, items: 0, byItem: new Map() };
    bb.spend += s; bb.items += qty;
    const bbi = bb.byItem.get(itemId) ?? { spend: 0n, qty: 0 };
    bbi.spend += s; bbi.qty += qty; bb.byItem.set(itemId, bbi);
    byBuyer.set(buyer, bb);

    if (cutoffBlock >= 0 && Number(r.block_number) >= cutoffBlock) { total7 += s; items7 += qty; purch7++; }
  }

  const sortItems = (m: Map<number, { spend: bigint; qty: number }>): NamedItemRow[] =>
    [...m.entries()].sort((a, b) => (b[1].spend > a[1].spend ? 1 : b[1].spend < a[1].spend ? -1 : 0))
      .map(([itemId, v]) => ({ itemId, name: CONSUMABLE_NAMES[itemId] ?? `Item #${itemId}`, spendWei: v.spend.toString(), spendEth: weiToEthString(v.spend), quantity: v.qty }));

  const stats: ItemStatsAgg = {
    totalSpendWei: total.toString(),
    totalSpendEth: weiToEthString(total),
    itemsBought: items,
    uniqueBuyers: buyers.size,
    uniqueBuyersAll: allBuyers.size,
    pricedPurchases: priced,
    unpricedPurchases: unpriced,
    dung: { spendWei: dungWei.toString(), spendEth: weiToEthString(dungWei), itemsBought: dungItems },
    butterfly: { spendWei: buttWei.toString(), spendEth: weiToEthString(buttWei), itemsBought: buttItems },
    byItem: sortItems(byItem),
    window7d: { spendWei: total7.toString(), spendEth: weiToEthString(total7), itemsBought: items7, purchases: purch7 },
    allItems: { spendWei: allWei.toString(), spendEth: weiToEthString(allWei), itemsBought: allItemsCount, pricedPurchases: allPriced },
    generatedAt: new Date().toISOString(),
    lastIndexedBlock: cursor ? Number(cursor.lastBlock) : null,
    headBlock: head,
    complete: cursor != null, // cursor is set only when the full backfill reaches head
  };

  const spenders = [...byBuyer.entries()]
    .sort((a, b) => (b[1].spend > a[1].spend ? 1 : b[1].spend < a[1].spend ? -1 : 0))
    .slice(0, 100)
    .map(([address, v], i) => ({
      rank: i + 1,
      address,
      username: nameMap.get(address) ?? null,
      totalSpendWei: v.spend.toString(),
      totalSpendEth: weiToEthString(v.spend),
      itemsBought: v.items,
      byItem: sortItems(v.byItem).slice(0, 12),
    }));

  const leaderboard: ItemLeaderboardAgg = { spenders, uniqueBuyers: buyers.size, complete: cursor != null, generatedAt: new Date().toISOString() };

  await setSyncState(ITEM_STATS_KEY, stats);
  await setSyncState(ITEM_LEADERBOARD_KEY, leaderboard);
  return { stats, leaderboard };
}

export interface CronResult {
  mode: string;
  range: { from: number; to: number };
  index: IndexResult;
  usernamesResolved: number;
  cursorAdvancedTo: number | null;
  backfillNextBlock: number | null;
  complete: boolean;
  totals: { spendEth: string; itemsBought: number; uniqueBuyers: number; uniqueBuyersAll: number; pricedPurchases: number };
}

// One cron pass. Each pass returns well under Vercel's ~60s edge first-byte limit, so the full
// backfill runs as many resumable passes. Modes:
//   from/to        -> index exactly that range, do NOT advance the cursor (verification/manual).
//   mode=full      -> resume the deploy->latest backfill (advances cursor only on full catch-up).
//   mode=resolve   -> resolve usernames only (no chain indexing) + re-materialize.
//   mode=incremental (default) -> from cursor+1 to latest, advance cursor.
export async function runItemSpendCron(opts: { mode?: string; from?: bigint; to?: bigint; budgetMs?: number; resolveLimit?: number }): Promise<CronResult> {
  const head = await latestBlock();
  let mode = opts.mode ?? "incremental";

  const emptyIndex: IndexResult = { fromBlock: 0, lastProcessed: 0, done: true, listings: 0, purchases: 0, priced: 0 };
  const pack = (extra: Partial<CronResult>, stats: ItemStatsAgg): CronResult => ({
    mode, range: { from: 0, to: 0 }, index: emptyIndex, usernamesResolved: 0, cursorAdvancedTo: null,
    backfillNextBlock: null, complete: stats.complete,
    totals: { spendEth: stats.totalSpendEth, itemsBought: stats.itemsBought, uniqueBuyers: stats.uniqueBuyers, uniqueBuyersAll: stats.uniqueBuyersAll, pricedPurchases: stats.pricedPurchases },
    ...extra,
  });

  // Resolve-only pass: backfill usernames in batches without touching the chain index.
  if (mode === "resolve") {
    const usernamesResolved = await resolveBuyerUsernames(opts.resolveLimit ?? 400, 10);
    const { stats } = await materializeItemAggregates();
    return pack({ usernamesResolved }, stats);
  }

  // Indexing budget kept under the edge limit; the full backfill is many short resumable passes.
  const budgetMs = opts.budgetMs ?? (mode === "full" ? 30_000 : 35_000);
  let from: bigint, to: bigint, advanceCursor = false, backfillNext: number | null = null;

  if (opts.from != null && opts.to != null) {
    mode = "range";
    from = opts.from; to = opts.to;
  } else if (mode === "full") {
    const bf = await getSyncState<{ nextBlock: string }>(BACKFILL_KEY);
    from = bf ? BigInt(bf.nextBlock) : ITEM_MARKET_DEPLOY_BLOCK;
    to = head;
  } else {
    const cur = await getSyncState<{ lastBlock: string }>(CURSOR_KEY);
    if (!cur) {
      // No cursor yet: a bounded backfill must run first. Do nothing rather than silently
      // launch a full deploy->latest scan from an incremental tick.
      const { stats } = await materializeItemAggregates();
      return pack({ mode: "incremental" }, stats);
    }
    from = BigInt(cur.lastBlock) + 1n; to = head; advanceCursor = true;
  }

  const index = await indexItemSpend(from, to, budgetMs);

  let cursorAdvancedTo: number | null = null;
  if (mode === "full") {
    backfillNext = index.lastProcessed + 1;
    await setSyncState(BACKFILL_KEY, { nextBlock: String(backfillNext) });
    if (index.done) { await setSyncState(CURSOR_KEY, { lastBlock: String(to) }); cursorAdvancedTo = Number(to); }
  } else if (advanceCursor && index.done) {
    await setSyncState(CURSOR_KEY, { lastBlock: String(to) });
    cursorAdvancedTo = Number(to);
  }

  // Username resolution is skipped during full-backfill passes (kept fast); run it via
  // mode=resolve / incremental once the index is built. resolveLimit lets a shared cron (the
  // ingest orchestrator) keep this cheap.
  const usernamesResolved = mode === "full" ? 0 : await resolveBuyerUsernames(opts.resolveLimit ?? 200);
  const { stats } = await materializeItemAggregates();

  return {
    mode,
    range: { from: Number(from), to: Number(to) },
    index,
    usernamesResolved,
    cursorAdvancedTo,
    backfillNextBlock: backfillNext,
    complete: stats.complete,
    totals: { spendEth: stats.totalSpendEth, itemsBought: stats.itemsBought, uniqueBuyers: stats.uniqueBuyers, uniqueBuyersAll: stats.uniqueBuyersAll, pricedPurchases: stats.pricedPurchases },
  };
}
