import { setSyncState } from "../syncState";
import { getDailyEthUsd, priceOnDay } from "../ethPriceHistory";

// GigaJuice revenue, measured authoritatively. A Juice buy is a successful tx TO a Juice contract
// whose input selector is 0x52ce66cc; the tier is calldata word 1 (1-4) and the price is a FIXED
// table (NOT read from value/transfers: these are AA txs whose ETH is swept onward via an
// internal call, so the contract's logs/balance/nonce and the 0x800a `to`-topic do NOT reflect
// revenue, only the per-tx calldata + value do). We enumerate buys via the Abstract explorer
// txlist (the only source of per-tx calldata), sum fixed prices in integer wei, and bucket by
// timestamp for rolling 24h/7d windows. Read-only.
//
// TWO RAILS, disjoint and sequential (Juice MOVED contracts on 2026-03-24, it never stopped):
//   OLD rail (0xD249 + 0xD154): 2025-05-01 -> 2026-03-24, ~41,600 buys, ~440.4 ETH (now frozen).
//   LIVE rail (0x0e5c, GigaJuiceSystem in /api/contracts): 2026-03-24 -> now, active every day.
// All-time = old + live (no double-count: different contracts, tx_hash-deduped). 24h/7d come from
// the live rail (the old rail contributes 0 to recent windows).

const OLD_CONTRACTS = ["0xd24902e148ccf3e12cd7fbb90a0428b62afabd95", "0xd154ab0de91094bfa8e87808f9a0f7f1b98e1ce1"];
const LIVE_CONTRACT = "0x0e5ca01b63acd1841489ca87d0ab33f692e5a7ba";
const ALL_CONTRACTS = [...OLD_CONTRACTS, LIVE_CONTRACT];
const SELECTOR = "0x52ce66cc";
const PRICE_WEI: Record<number, bigint> = { 1: 4_000_000_000_000_000n, 2: 10_000_000_000_000_000n, 3: 23_000_000_000_000_000n, 4: 38_000_000_000_000_000n };
const EXPLORER = "https://block-explorer-api.mainnet.abs.xyz/api";
const PAGE = 1000; // explorer caps page*offset <= 1000

export const JUICE_SNAPSHOT_KEY = "juice_revenue_v1";

export interface JuiceSnapshot {
  allTimeWei: string; allTimeEth: string; allTimeCount: number; allTimeTiers: Record<number, number>;
  // lifetime USD valued at EACH buy's own-day ETH price (not today's). impliedAvgEthUsd =
  // lifetimeUsd / lifetimeEth (the volume-weighted ETH price the revenue was earned at).
  lifetimeUsd: number; impliedAvgEthUsd: number;
  perRailUsd: Record<string, number>; perMonthUsd: Record<string, number>; perMonthEth: Record<string, number>;
  oldRailEth: string; oldRailCount: number; liveRailEth: string; liveRailCount: number;
  w7dWei: string; w7dEth: string; w7dCount: number;
  w30dWei: string; w30dEth: string; w30dCount: number;
  reconciled: boolean; generatedAt: string;
}

const ethStr = (wei: bigint, dp = 6) => `${wei / 10n ** 18n}.${(wei % 10n ** 18n).toString().padStart(18, "0").slice(0, dp)}`;

interface Buy { tier: number; ts: number }
interface TxRow { hash: string; to?: string; input?: string; isError?: string; timeStamp?: string; blockNumber?: string }

async function getJson(url: string, tries = 5): Promise<{ status?: string; result?: TxRow[] }> {
  for (let a = 0; a < tries; a++) {
    try { const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" }); return (await r.json()) as { status?: string; result?: TxRow[] }; }
    catch (e) { if (a === tries - 1) throw e; await new Promise((s) => setTimeout(s, 500 * (a + 1))); }
  }
  return {};
}

// Enumerate Juice buys to one contract by walking startblock (page*offset capped at 1000), with
// tx_hash dedup at page boundaries so nothing is double-counted or skipped (gaps = undercount).
async function enumerate(contract: string): Promise<Buy[]> {
  const seen = new Set<string>();
  const buys: Buy[] = [];
  let startblock = 0;
  // High page guard: never truncate a high-traffic rail mid-scan (the loop's own
  // rows<PAGE / no-progress conditions are the real terminators; this is only a runaway backstop).
  for (let guard = 0; guard < 100_000; guard++) {
    const url = `${EXPLORER}?module=account&action=txlist&address=${contract}&startblock=${startblock}&endblock=99999999&page=1&offset=${PAGE}&sort=asc`;
    const j = await getJson(url);
    const rows = Array.isArray(j.result) ? j.result : [];
    if (j.status !== "1" || rows.length === 0) break;
    let fresh = 0;
    for (const t of rows) {
      if (seen.has(t.hash)) continue;
      seen.add(t.hash); fresh++;
      if ((t.to || "").toLowerCase() !== contract) continue;
      if (!(t.input || "").startsWith(SELECTOR)) continue;
      if (t.isError !== "0") continue;
      const tier = parseInt((t.input as string).slice(10, 74), 16);
      if (tier >= 1 && tier <= 4) buys.push({ tier, ts: Number(t.timeStamp) });
    }
    if (rows.length < PAGE) break;
    const lastBlock = Number(rows[rows.length - 1].blockNumber);
    if (lastBlock <= startblock && fresh === 0) break;
    startblock = lastBlock; // re-fetch the boundary block; seen-set dedups the overlap
  }
  return buys;
}

const PRICE_ETH: Record<number, number> = { 1: 0.004, 2: 0.010, 3: 0.023, 4: 0.038 };
const dayOf = (tsSec: number) => new Date(tsSec * 1000).toISOString().slice(0, 10);
const monthOf = (tsSec: number) => new Date(tsSec * 1000).toISOString().slice(0, 7);

export async function computeJuiceRevenue(): Promise<JuiceSnapshot> {
  // Enumerate each contract; tag buys by rail for the breakdown. Different contracts/txs, so the
  // combined total never double-counts (and tx_hash dedup is per-contract).
  const perContract = await Promise.all(ALL_CONTRACTS.map(async (c) => ({ c, buys: await enumerate(c) })));
  const days = await getDailyEthUsd();
  const sortedKeys = Object.keys(days).sort();
  const now = Math.floor(Date.now() / 1000);

  let allWei = 0n, w7 = 0n, w30 = 0n, n7 = 0, n30 = 0, allN = 0;
  let oldWei = 0n, oldN = 0, liveWei = 0n, liveN = 0;
  let lifetimeUsd = 0;
  const tiers: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const perRailUsd: Record<string, number> = {};
  const perMonthUsd: Record<string, number> = {}, perMonthEth: Record<string, number> = {};
  for (const { c, buys } of perContract) {
    const isLive = c === LIVE_CONTRACT;
    const railKey = isLive ? "live" : c;
    for (const b of buys) {
      const p = PRICE_WEI[b.tier];
      allWei += p; allN++; tiers[b.tier]++;
      if (isLive) { liveWei += p; liveN++; } else { oldWei += p; oldN++; }
      // historical USD: value the buy at its OWN day's ETH price
      const px = priceOnDay(days, sortedKeys, dayOf(b.ts));
      const usd = px != null ? PRICE_ETH[b.tier] * px : 0;
      lifetimeUsd += usd;
      perRailUsd[railKey] = (perRailUsd[railKey] ?? 0) + usd;
      const m = monthOf(b.ts);
      perMonthUsd[m] = (perMonthUsd[m] ?? 0) + usd;
      perMonthEth[m] = (perMonthEth[m] ?? 0) + PRICE_ETH[b.tier];
      // rolling windows (live rail only contributes; old rails are far in the past)
      if (b.ts >= now - 7 * 86_400) { w7 += p; n7++; }
      if (b.ts >= now - 30 * 86_400) { w30 += p; n30++; }
    }
  }

  const lifetimeEth = Number(ethStr(allWei));
  // Gate: render only once the enumeration is complete and the historical USD computed, which
  // REQUIRES the live rail (old rail is ~41,600 alone, so total > 42,000 proves the live rail was
  // included) and the price series resolved (lifetimeUsd well above the today's-price floor).
  const reconciled = allN >= 42_000 && liveN > 0 && lifetimeUsd > 0 && lifetimeEth >= 450;

  const snapshot: JuiceSnapshot = {
    allTimeWei: allWei.toString(), allTimeEth: ethStr(allWei), allTimeCount: allN, allTimeTiers: tiers,
    lifetimeUsd: Math.round(lifetimeUsd), impliedAvgEthUsd: lifetimeEth > 0 ? Math.round(lifetimeUsd / lifetimeEth) : 0,
    perRailUsd, perMonthUsd, perMonthEth,
    oldRailEth: ethStr(oldWei), oldRailCount: oldN, liveRailEth: ethStr(liveWei), liveRailCount: liveN,
    w7dWei: w7.toString(), w7dEth: ethStr(w7), w7dCount: n7,
    w30dWei: w30.toString(), w30dEth: ethStr(w30), w30dCount: n30,
    reconciled, generatedAt: new Date().toISOString(),
  };
  await setSyncState(JUICE_SNAPSHOT_KEY, snapshot);
  return snapshot;
}
