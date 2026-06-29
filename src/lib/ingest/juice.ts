import { setSyncState } from "../syncState";

// GigaJuice revenue, measured the authoritative way (matches Dune jdhyper/gigaverse-abstract
// query 5073984: 440.41 ETH / 41,600 buys). A Juice buy is a successful tx TO one of the two
// Juice contracts whose input selector is 0x52ce66cc; the tier is calldata word 1 (1-4) and the
// price is a FIXED table (NOT read from value/transfers, which carry dust + paymaster routing).
// We enumerate buys via the Abstract explorer txlist (the only source of per-tx calldata), sum
// fixed prices in integer wei, and bucket by timestamp for rolling 24h/7d windows. Read-only.
//
// NOTE: buying paused ~Sept 2025, so the all-time total is frozen and recent windows are 0.

const JUICE_CONTRACTS = ["0xd24902e148ccf3e12cd7fbb90a0428b62afabd95", "0xd154ab0de91094bfa8e87808f9a0f7f1b98e1ce1"];
const SELECTOR = "0x52ce66cc";
const PRICE_WEI: Record<number, bigint> = { 1: 4_000_000_000_000_000n, 2: 10_000_000_000_000_000n, 3: 23_000_000_000_000_000n, 4: 38_000_000_000_000_000n };
const EXPLORER = "https://block-explorer-api.mainnet.abs.xyz/api";
const PAGE = 1000; // explorer caps page*offset <= 1000
const DUNE_REF_ETH = 440.41;

export const JUICE_SNAPSHOT_KEY = "juice_revenue_v1";

export interface JuiceSnapshot {
  allTimeWei: string; allTimeEth: string; allTimeCount: number; allTimeTiers: Record<number, number>;
  w7dWei: string; w7dEth: string; w7dCount: number;
  w24hWei: string; w24hEth: string; w24hCount: number;
  reconciled: boolean; duneRefEth: number; generatedAt: string;
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
  for (let guard = 0; guard < 400; guard++) {
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

export async function computeJuiceRevenue(): Promise<JuiceSnapshot> {
  const all = (await Promise.all(JUICE_CONTRACTS.map(enumerate))).flat();
  const now = Math.floor(Date.now() / 1000);

  let allWei = 0n, w7 = 0n, w24 = 0n, n7 = 0, n24 = 0;
  const tiers: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const b of all) {
    const p = PRICE_WEI[b.tier];
    allWei += p; tiers[b.tier]++;
    if (b.ts >= now - 7 * 86_400) { w7 += p; n7++; }
    if (b.ts >= now - 86_400) { w24 += p; n24++; }
  }

  // Gate: only trust the figure once the enumeration is essentially complete (near Dune's
  // 440 ETH / 41,600). A partial backfill (explorer hiccup) stays below the floor and is hidden.
  const allEthNum = Number(ethStr(allWei));
  const reconciled = allEthNum >= DUNE_REF_ETH * 0.97 && all.length >= 41_000;

  const snapshot: JuiceSnapshot = {
    allTimeWei: allWei.toString(), allTimeEth: ethStr(allWei), allTimeCount: all.length, allTimeTiers: tiers,
    w7dWei: w7.toString(), w7dEth: ethStr(w7), w7dCount: n7,
    w24hWei: w24.toString(), w24hEth: ethStr(w24), w24hCount: n24,
    reconciled, duneRefEth: DUNE_REF_ETH, generatedAt: new Date().toISOString(),
  };
  await setSyncState(JUICE_SNAPSHOT_KEY, snapshot);
  return snapshot;
}
