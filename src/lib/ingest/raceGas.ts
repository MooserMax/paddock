import type { Hex } from "viem";
import { db } from "../db";
import { getSyncState, setSyncState } from "../syncState";
import { chainClient, latestBlock, RACING_START_BLOCK, TOPIC_RACE_CREATED, TOPIC_RACE_JOINED, DEFAULT_RPC_URL } from "../chain";
import { optionalEnv } from "../env";

const RPC_URL = optionalEnv("RPC_URL") ?? DEFAULT_RPC_URL;

// Player gas fees for race CREATE + ENTER transactions, summed from real on-chain receipts.
// A tx is a create/enter iff it contains a RACE_CREATED / RACE_JOINED log from a racing
// contract (the tx itself is often sent to an AGW/router, so the `to` address and the input
// selector are unreliable; the EVENT is the reliable classifier, and these topics are the ones
// the races pipeline already verifies against the public race API). The fee of each tx is
// gasUsed x effectiveGasPrice from its receipt, summed in integer wei; ETH only at display.
//
// This is gas/transaction fees ONLY, entirely separate from entry-fee volume (ETH staked into
// races) and from item spend. Two contract eras are covered: the old racing contract and the
// current PetRacingSystem; each emits these events only in its own era, so scanning both over
// the full range captures all-time create+enter gas.

const RACING_OLD = "0x16e0b3d6394ce7597d34b73f5e5fb165fd74394e"; // historical races
const PETRACING = "0xf6ed2a53f311352c869e268601aae5b78b9a9650"; // current PetRacingSystem
const RACE_CONTRACTS = [RACING_OLD, PETRACING];

const CURSOR_KEY = "race_gas_scan";       // { lastBlock } -- deploy->here indexed (set on full catch-up)
const BACKFILL_KEY = "race_gas_backfill";  // { nextBlock } -- resumable full backfill progress
export const RACE_GAS_KEY = "race_gas_v1"; // materialized snapshot

const CHUNK = 9000n;
const RECEIPT_BATCH = 40; // JSON-RPC batch size for receipts

interface RawLog { topics: Hex[]; blockNumber: Hex; transactionHash: Hex }

// eth_getLogs for the race events over [from,to] for one contract, halve-on-cap.
async function fetchRaceEventLogs(addr: string, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
  if (fromBlock > toBlock) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [{ address: addr as Hex, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}`, topics: [[TOPIC_RACE_CREATED, TOPIC_RACE_JOINED]] }],
    })) as unknown as RawLog[];
  } catch (err) {
    if (toBlock - fromBlock < 1n) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    return [...await fetchRaceEventLogs(addr, fromBlock, mid), ...await fetchRaceEventLogs(addr, mid + 1n, toBlock)];
  }
}

// Batched eth_getTransactionReceipt. Returns tx_hash -> fee_wei (gasUsed x effectiveGasPrice).
async function fetchReceiptFees(txs: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  for (let i = 0; i < txs.length; i += RECEIPT_BATCH) {
    const slice = txs.slice(i, i + RECEIPT_BATCH);
    const body = slice.map((h, k) => ({ jsonrpc: "2.0", id: k, method: "eth_getTransactionReceipt", params: [h] }));
    const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const arr = (await res.json()) as { id: number; result?: { gasUsed: string; effectiveGasPrice: string } }[];
    for (const r of arr) {
      const h = slice[r.id];
      if (r.result?.gasUsed && r.result?.effectiveGasPrice) out.set(h, BigInt(r.result.gasUsed) * BigInt(r.result.effectiveGasPrice));
    }
  }
  return out;
}

// Page through a table past PostgREST's 1000-row SELECT cap with a stable unique order.
async function readAllRows<T = Record<string, unknown>>(table: string, columns: string, orderCols: string[]): Promise<T[]> {
  const PAGE = 1000; const out: T[] = [];
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

// Which of these tx hashes are already stored (so we never re-fetch a receipt or double-count).
async function existingTxs(txs: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < txs.length; i += 500) {
    const { data, error } = await db().from("race_gas_fees").select("tx_hash").in("tx_hash", txs.slice(i, i + 500));
    if (error) throw new Error(`race_gas_fees read failed: ${error.message}`);
    for (const r of data ?? []) set.add(r.tx_hash as string);
  }
  return set;
}

export interface RaceGasIndexResult { fromBlock: number; lastProcessed: number; done: boolean; txsSeen: number; txsNew: number }

// Index create+enter gas over [from,to] in ascending chunks. For each chunk: collect distinct
// tx hashes from RACE_CREATED/RACE_JOINED logs (both contracts), fetch receipts only for hashes
// not already stored, upsert (tx_hash PK) so re-runs insert zero rows. Resumable on budgetMs.
export async function indexRaceGas(from: bigint, to: bigint, budgetMs: number): Promise<RaceGasIndexResult> {
  const deadline = Date.now() + budgetMs;
  let txsSeen = 0, txsNew = 0;
  let lastProcessed = from - 1n;

  for (let cur = from; cur <= to; cur += CHUNK) {
    const end = cur + CHUNK - 1n > to ? to : cur + CHUNK - 1n;
    const logs: RawLog[] = [];
    for (const addr of RACE_CONTRACTS) logs.push(...await fetchRaceEventLogs(addr, cur, end));

    const txMeta = new Map<string, { create: boolean; enter: boolean; block: number }>();
    for (const l of logs) {
      const t = l.transactionHash.toLowerCase();
      const m = txMeta.get(t) ?? { create: false, enter: false, block: Number(BigInt(l.blockNumber)) };
      if (l.topics[0] === TOPIC_RACE_CREATED) m.create = true;
      if (l.topics[0] === TOPIC_RACE_JOINED) m.enter = true;
      txMeta.set(t, m);
    }
    const allTxs = [...txMeta.keys()];
    txsSeen += allTxs.length;

    if (allTxs.length) {
      const have = await existingTxs(allTxs);
      const todo = allTxs.filter((t) => !have.has(t));
      if (todo.length) {
        const fees = await fetchReceiptFees(todo);
        const rows = todo
          .filter((t) => fees.has(t))
          .map((t) => {
            const m = txMeta.get(t)!;
            return { tx_hash: t, block_number: m.block, fee_wei: fees.get(t)!.toString(), is_create: m.create, is_enter: m.enter };
          });
        if (rows.length) {
          const { error } = await db().from("race_gas_fees").upsert(rows, { onConflict: "tx_hash" });
          if (error) throw new Error(`race_gas_fees upsert failed: ${error.message}`);
          txsNew += rows.length;
        }
      }
    }

    lastProcessed = end;
    if (Date.now() > deadline) break;
  }
  return { fromBlock: Number(from), lastProcessed: Number(lastProcessed), done: lastProcessed >= to, txsSeen, txsNew };
}

export function weiToEthString(wei: bigint, dp = 7): string {
  const w = wei < 0n ? -wei : wei;
  return `${wei < 0n ? "-" : ""}${w / 10n ** 18n}.${(w % 10n ** 18n).toString().padStart(18, "0").slice(0, dp)}`;
}

export interface RaceGasAgg {
  totalFeeWei: string;
  totalFeeEth: string;
  txCount: number;
  createTxs: number; // txs containing a RACE_CREATED log
  enterTxs: number;  // txs containing a RACE_JOINED log
  generatedAt: string;
  lastIndexedBlock: number | null;
  headBlock: number | null;
  complete: boolean;
}

// Sum every stored fee (integer wei) into the snapshot. Paginated read (past the 1000 cap).
export async function materializeRaceGas(): Promise<RaceGasAgg> {
  const rows = await readAllRows<{ fee_wei: string; is_create: boolean; is_enter: boolean }>("race_gas_fees", "fee_wei, is_create, is_enter, tx_hash", ["tx_hash"]);
  const cursor = await getSyncState<{ lastBlock: string }>(CURSOR_KEY);
  const head = Number(await latestBlock());
  let total = 0n, createTxs = 0, enterTxs = 0;
  for (const r of rows) { total += BigInt(r.fee_wei); if (r.is_create) createTxs++; if (r.is_enter) enterTxs++; }
  const agg: RaceGasAgg = {
    totalFeeWei: total.toString(),
    totalFeeEth: weiToEthString(total),
    txCount: rows.length,
    createTxs,
    enterTxs,
    generatedAt: new Date().toISOString(),
    lastIndexedBlock: cursor ? Number(cursor.lastBlock) : null,
    headBlock: head,
    complete: cursor != null,
  };
  await setSyncState(RACE_GAS_KEY, agg);
  return agg;
}

export interface RaceGasCronResult {
  mode: string;
  range: { from: number; to: number };
  index: RaceGasIndexResult;
  cursorAdvancedTo: number | null;
  backfillNextBlock: number | null;
  complete: boolean;
  totals: { feeEth: string; txCount: number; createTxs: number; enterTxs: number };
}

// One cron pass. Each returns under Vercel's ~60s edge limit; the full backfill is many
// resumable passes. Modes: from/to (range, no cursor advance) | full (resumable deploy->head)
// | incremental (cursor+1 -> head, advance cursor).
export async function runRaceGasCron(opts: { mode?: string; from?: bigint; to?: bigint; budgetMs?: number }): Promise<RaceGasCronResult> {
  const head = await latestBlock();
  let mode = opts.mode ?? "incremental";
  const budgetMs = opts.budgetMs ?? (mode === "full" ? 30_000 : 35_000);
  let from: bigint, to: bigint, advanceCursor = false, backfillNext: number | null = null;

  if (opts.from != null && opts.to != null) {
    mode = "range"; from = opts.from; to = opts.to;
  } else if (mode === "full") {
    const bf = await getSyncState<{ nextBlock: string }>(BACKFILL_KEY);
    from = bf ? BigInt(bf.nextBlock) : RACING_START_BLOCK;
    to = head;
  } else {
    const cur = await getSyncState<{ lastBlock: string }>(CURSOR_KEY);
    if (!cur) { const agg = await materializeRaceGas(); return packResult("incremental", { from: 0, to: 0 }, { fromBlock: 0, lastProcessed: 0, done: true, txsSeen: 0, txsNew: 0 }, null, null, agg); }
    from = BigInt(cur.lastBlock) + 1n; to = head; advanceCursor = true;
  }

  const index = await indexRaceGas(from, to, budgetMs);

  let cursorAdvancedTo: number | null = null;
  if (mode === "full") {
    backfillNext = index.lastProcessed + 1;
    await setSyncState(BACKFILL_KEY, { nextBlock: String(backfillNext) });
    if (index.done) { await setSyncState(CURSOR_KEY, { lastBlock: String(to) }); cursorAdvancedTo = Number(to); }
  } else if (advanceCursor && index.done) {
    await setSyncState(CURSOR_KEY, { lastBlock: String(to) }); cursorAdvancedTo = Number(to);
  }

  const agg = await materializeRaceGas();
  return packResult(mode, { from: Number(from), to: Number(to) }, index, cursorAdvancedTo, backfillNext, agg);
}

function packResult(mode: string, range: { from: number; to: number }, index: RaceGasIndexResult, cursorAdvancedTo: number | null, backfillNext: number | null, agg: RaceGasAgg): RaceGasCronResult {
  return { mode, range, index, cursorAdvancedTo, backfillNextBlock: backfillNext, complete: agg.complete, totals: { feeEth: agg.totalFeeEth, txCount: agg.txCount, createTxs: agg.createTxs, enterTxs: agg.enterTxs } };
}
