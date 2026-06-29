import type { Hex } from "viem";
import { setSyncState, getSyncState } from "../syncState";
import { chainClient, latestBlock } from "../chain";
import { blockTimestamp } from "../itemMarket";

// GigaJuice revenue. Juice is bought with native ETH that lands in the GigaJuiceSystem contract;
// on Abstract/ZKsync those ETH moves are 0x800a Transfer events. Revenue = sum of INFLOW
// transfers (to = Juice contract). The contract has no logs of its own and forwards ETH out via
// internal calls (which do NOT bump its nonce), so the integrity identity is conservation:
//   all-time inflow  ==  current balance  +  all-time outflow (from = Juice contract).
// We maintain running inflow/outflow totals via a resumable cursor (scan only new blocks), and
// scan just the recent window for the rolling 24h/7d figures. Integer wei (BigInt); ETH at the
// edge. Verified this session: inflow 11.363 ETH == balance 4.988 + outflow 6.375 (exact).
// Read-only; never sends a tx.

const JUICE = "0x0e5ca01b63acd1841489ca87d0ab33f692e5a7ba"; // GigaJuiceSystem (from /api/contracts)
const ETH800A = "0x000000000000000000000000000000000000800a";
const XFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PAD_JUICE = `0x000000000000000000000000${JUICE.slice(2)}` as Hex;
const DEPLOY = 47_851_438; // eth_getCode binary search; first inflow at 47,872,868

const STATE_KEY = "juice_state";      // { cursor, backfillNext, inflowWei, outflowWei, inflowCount, outflowCount }
const SNAPSHOT_KEY = "juice_revenue_v1";
const CHUNK = 9000n;
const FULL_SEG = 2_000_000n;          // blocks per mode=full pass (scanned concurrently, < 60s)

export interface JuiceState { cursor: number | null; backfillNext: number; inflowWei: string; outflowWei: string; inflowCount: number; outflowCount: number }
const ZERO_STATE: JuiceState = { cursor: null, backfillNext: DEPLOY, inflowWei: "0", outflowWei: "0", inflowCount: 0, outflowCount: 0 };

export interface JuiceSnapshot {
  allTimeWei: string; allTimeEth: string; allTimeCount: number;
  w7dWei: string; w7dEth: string; w7dCount: number;
  w24hWei: string; w24hEth: string; w24hCount: number;
  balanceWei: string; outflowWei: string;
  reconciled: boolean; // inflow == balance + outflow AND backfill complete
  lastIndexedBlock: number | null; headBlock: number;
  generatedAt: string;
}

const ethStr = (wei: bigint, dp = 6) => `${wei / 10n ** 18n}.${(wei % 10n ** 18n).toString().padStart(18, "0").slice(0, dp)}`;

interface XLog { data: Hex; blockNumber: Hex }

// One chunked, halve-on-cap eth_getLogs over [from,to] for a topic filter.
async function getLogs(topics: (Hex | null | Hex[])[], from: bigint, to: bigint): Promise<XLog[]> {
  if (from > to) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [{ address: ETH800A as Hex, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics }],
    })) as unknown as XLog[];
  } catch (err) {
    if (to - from < 1n) throw err;
    const mid = from + (to - from) / 2n;
    return [...await getLogs(topics, from, mid), ...await getLogs(topics, mid + 1n, to)];
  }
}

// Concurrent scan of [from,to] for a topic filter, returning logs.
async function scanConcurrent(topics: (Hex | null | Hex[])[], from: bigint, to: bigint, conc = 8): Promise<XLog[]> {
  const segs: [bigint, bigint][] = [];
  for (let f = from; f <= to; f += CHUNK) segs.push([f, f + CHUNK - 1n > to ? to : f + CHUNK - 1n]);
  const acc: XLog[][] = new Array(segs.length);
  let next = 0;
  const worker = async () => { while (next < segs.length) { const i = next++; acc[i] = await getLogs(topics, segs[i][0], segs[i][1]); } };
  await Promise.all(Array.from({ length: Math.min(conc, segs.length) }, worker));
  return acc.flat();
}

const IN_TOPICS: (Hex | null)[] = [XFER as Hex, null, PAD_JUICE];
const OUT_TOPICS: (Hex | null)[] = [XFER as Hex, PAD_JUICE, null];
const sumWei = (logs: XLog[]) => logs.reduce((s, l) => s + BigInt(l.data), 0n);

// Index inflow + outflow over [from,to] and return the deltas. Used by full (segmented) and
// incremental modes; both fold the delta into the running totals.
async function indexRange(from: bigint, to: bigint): Promise<{ inWei: bigint; inN: number; outWei: bigint; outN: number }> {
  const [ins, outs] = await Promise.all([scanConcurrent(IN_TOPICS, from, to), scanConcurrent(OUT_TOPICS, from, to)]);
  return { inWei: sumWei(ins), inN: ins.length, outWei: sumWei(outs), outN: outs.length };
}

export interface JuiceCronResult { mode: string; range: { from: number; to: number }; cursorAdvancedTo: number | null; backfillNext: number | null; complete: boolean; snapshot: JuiceSnapshot }

export async function runJuiceCron(opts: { mode?: string } = {}): Promise<JuiceCronResult> {
  const head = Number(await latestBlock());
  const mode = opts.mode ?? "incremental";
  const st: JuiceState = (await getSyncState<JuiceState>(STATE_KEY)) ?? { ...ZERO_STATE };

  let cursorAdvancedTo: number | null = null;
  let backfillNext: number | null = null;

  if (st.cursor == null) {
    // Resumable backfill: one FULL_SEG pass folds its delta into the running totals atomically.
    const from = BigInt(st.backfillNext);
    const to = from + FULL_SEG - 1n > BigInt(head) ? BigInt(head) : from + FULL_SEG - 1n;
    if (mode === "full") {
      const d = await indexRange(from, to);
      const done = Number(to) >= head;
      const ns: JuiceState = {
        cursor: done ? head : null,
        backfillNext: Number(to) + 1,
        inflowWei: (BigInt(st.inflowWei) + d.inWei).toString(),
        outflowWei: (BigInt(st.outflowWei) + d.outWei).toString(),
        inflowCount: st.inflowCount + d.inN,
        outflowCount: st.outflowCount + d.outN,
      };
      await setSyncState(STATE_KEY, ns);
      backfillNext = ns.backfillNext;
      if (done) cursorAdvancedTo = head;
      Object.assign(st, ns);
    }
    // (incremental is a no-op until the backfill has set a cursor)
  } else if (mode === "incremental" || mode === "full") {
    const from = BigInt(st.cursor + 1);
    if (from <= BigInt(head)) {
      const d = await indexRange(from, BigInt(head));
      const ns: JuiceState = {
        cursor: head, backfillNext: st.backfillNext,
        inflowWei: (BigInt(st.inflowWei) + d.inWei).toString(),
        outflowWei: (BigInt(st.outflowWei) + d.outWei).toString(),
        inflowCount: st.inflowCount + d.inN, outflowCount: st.outflowCount + d.outN,
      };
      await setSyncState(STATE_KEY, ns);
      cursorAdvancedTo = head;
      Object.assign(st, ns);
    }
  }

  // Rolling windows: scan only the recent range for inflow, bucket by exact 24h/7d cutoffs.
  const tHead = (await blockTimestamp(head)) ?? Math.floor(Date.now() / 1000);
  const blockAtOrAfter = async (target: number) => { let l = DEPLOY, h = head; while (l < h) { const m = (l + h) >> 1; const ts = await blockTimestamp(m); if (ts != null && ts >= target) h = m; else l = m + 1; } return l; };
  const cut7d = await blockAtOrAfter(tHead - 7 * 86_400);
  const cut24 = await blockAtOrAfter(tHead - 86_400);
  const recent = await scanConcurrent(IN_TOPICS, BigInt(cut7d), BigInt(head));
  let w7 = 0n, w24 = 0n, n7 = 0, n24 = 0;
  for (const l of recent) { const wei = BigInt(l.data); const b = Number(BigInt(l.blockNumber)); if (b >= cut7d) { w7 += wei; n7++; } if (b >= cut24) { w24 += wei; n24++; } }

  const balance = BigInt(await chainClient().request({ method: "eth_getBalance", params: [JUICE as Hex, "latest"] }) as string);
  const inflow = BigInt(st.inflowWei), outflow = BigInt(st.outflowWei);
  const reconciled = st.cursor != null && inflow - outflow === balance;

  const snapshot: JuiceSnapshot = {
    allTimeWei: inflow.toString(), allTimeEth: ethStr(inflow), allTimeCount: st.inflowCount,
    w7dWei: w7.toString(), w7dEth: ethStr(w7), w7dCount: n7,
    w24hWei: w24.toString(), w24hEth: ethStr(w24), w24hCount: n24,
    balanceWei: balance.toString(), outflowWei: outflow.toString(),
    reconciled, lastIndexedBlock: st.cursor, headBlock: head, generatedAt: new Date().toISOString(),
  };
  await setSyncState(SNAPSHOT_KEY, snapshot);

  return { mode, range: { from: Number(st.backfillNext), to: head }, cursorAdvancedTo, backfillNext, complete: st.cursor != null, snapshot };
}
