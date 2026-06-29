import type { Hex } from "viem";
import { setSyncState } from "../syncState";
import { chainClient, latestBlock } from "../chain";
import { blockTimestamp } from "../itemMarket";

// Trailing-24h PAID racing volume = entry fees STAKED into paid races in the last 24 hours
// (money IN, NOT payouts). Measured on-chain, cheaply and exactly: on Abstract/ZKsync the entry
// fee is a native-ETH Transfer (emitted by the 0x800a base-token system contract) whose
// recipient is a racing contract. So we eth_getLogs those Transfers filtered by to=race contract
// (topic filter, no receipts) over the last 24h and sum the amounts in integer wei. Gas (to the
// bootloader) and payouts (from the contract) are excluded by the to-address filter; free/
// zero-fee develop races transfer nothing, so they contribute nothing. ETH only at display; USD
// at the panel from the live rate. Recomputed each cron tick so the trailing window slides.
//
// Verified: this matches an independent receipt-based scan of RACE_JOINED txs (same entry-fee
// transfers), and a sample entry decodes to 0.000505 ETH = 0.0005 base x 1.01 juiced protocol.

export const PAID_VOLUME_KEY = "paid_volume_24h_v1";

const ETH_TOKEN = "0x000000000000000000000000000000000000800a"; // ZKsync base-token (ETH) system contract
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RACE_CONTRACTS = [
  "0x16e0b3d6394ce7597d34b73f5e5fb165fd74394e",
  "0x0ba76cfc1735327e26018bc9aaf680c652e72f82",
  "0xf6ed2a53f311352c869e268601aae5b78b9a9650",
];
const TO_TOPICS = RACE_CONTRACTS.map((a) => `0x000000000000000000000000${a.slice(2)}`);
const CHUNK = 9000n;

export interface PaidVolume24h {
  volumeWei: string;
  volumeEth: string;
  paidEntries: number;
  windowHours: number;
  generatedAt: string;
}

interface XferLog { data: Hex }

// ETH-in Transfers to the race contracts over [from,to], filtered by the indexed `to` topic so
// only entry-fee inflows come back (no receipts). Halve-on-cap like the other readers.
async function fetchEntryFeeTransfers(fromBlock: bigint, toBlock: bigint): Promise<XferLog[]> {
  if (fromBlock > toBlock) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [
        {
          address: ETH_TOKEN as Hex,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [TRANSFER_TOPIC as Hex, null, TO_TOPICS as Hex[]],
        },
      ],
    })) as unknown as XferLog[];
  } catch (err) {
    if (toBlock - fromBlock < 1n) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    return [...await fetchEntryFeeTransfers(fromBlock, mid), ...await fetchEntryFeeTransfers(mid + 1n, toBlock)];
  }
}

function weiToEthStr(wei: bigint, dp = 6): string {
  return `${wei / 10n ** 18n}.${(wei % 10n ** 18n).toString().padStart(18, "0").slice(0, dp)}`;
}

// Smallest block whose timestamp >= targetTs, by binary search. Gives an EXACT 24h window
// regardless of Abstract's variable block time (a seconds-per-block estimate drifts).
async function blockAtOrAfter(targetTs: number, head: number): Promise<number> {
  let lo = Math.max(0, head - 300_000); // comfortably more than 24h of blocks
  let hi = head;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const ts = await blockTimestamp(mid);
    if (ts != null && ts >= targetTs) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export async function computePaidVolume24h(): Promise<PaidVolume24h> {
  const head = Number(await latestBlock());
  const tHead = (await blockTimestamp(head)) ?? Math.floor(Date.now() / 1000);
  const from = BigInt(await blockAtOrAfter(tHead - 86_400, head)); // exactly 24h of chain time

  const logs: XferLog[] = [];
  for (let cur = from; cur <= BigInt(head); cur += CHUNK) {
    const end = cur + CHUNK - 1n > BigInt(head) ? BigInt(head) : cur + CHUNK - 1n;
    logs.push(...await fetchEntryFeeTransfers(cur, end));
  }

  let vol = 0n;
  for (const l of logs) vol += BigInt(l.data);

  const result: PaidVolume24h = {
    volumeWei: vol.toString(),
    volumeEth: weiToEthStr(vol),
    paidEntries: logs.length,
    windowHours: 24,
    generatedAt: new Date().toISOString(),
  };
  await setSyncState(PAID_VOLUME_KEY, result);
  return result;
}
