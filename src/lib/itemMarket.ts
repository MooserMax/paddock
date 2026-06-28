import type { Hex } from "viem";
import { chainClient } from "./chain";

// ItemMarketSystem on Abstract: the on-chain orderbook for Gigaverse items. Two events
// matter, both decoded from real logs and verified against the live chain (see the
// independent recompute, spot-check tx 0xe04a3f01... = 13 x 6,100,000,000,000 wei =
// 0.0000793 ETH). Payment is NATIVE ETH (18 decimals); value=0 on the tx is an AGW
// smart-wallet artifact, the price lives in the listing.
export const ITEM_MARKET_CONTRACT = "0x37d6dbfa9f82ac4acc86d49702ac0612d3aa1afe";

// Deploy block found empirically by eth_getCode binary search (first block with code).
// Backfill starts here, never block 0.
export const ITEM_MARKET_DEPLOY_BLOCK = 57_936_371n;

// ListingCreated(uint256 indexed listingId, uint256 indexed itemId, uint256 amount,
//   uint256 pricePerItem, address indexed owner)
//   topic1 = listingId, topic2 = itemId, topic3 = owner (THE SELLER, never a buyer).
//   data word0 = amount, data word1 = pricePerItem (wei). THE PRICE IS DATA WORD1.
export const TOPIC_LISTING_CREATED =
  "0x192159a6dc1e070350fc1d7970417b6a119fe2487724e578128eef7e749757ff";

// TransferFromListing(uint256 indexed transferId, uint256 indexed listingId,
//   address indexed transferredTo, uint256 amount) -- THE ACTUAL PURCHASE.
//   topic1 = transferId, topic2 = listingId, topic3 = transferredTo (THE BUYER),
//   data word0 = amount (quantity). Carries NO price; price comes from the listing.
export const TOPIC_TRANSFER_FROM_LISTING =
  "0x55260634f3c3ee34ea233d40699cbe600a2f04ca5ec17c0bb85c382e05bbe7ef";

// A log with the fields we need, including logIndex (not on chain.ts RawLog) because the
// purchase primary key is (txHash, logIndex) for exact idempotency.
export interface ItemLog {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

const word = (data: string, i: number): bigint => BigInt("0x" + data.slice(2 + i * 64, 2 + (i + 1) * 64));
const addrFromTopic = (t: string): string => ("0x" + t.slice(26)).toLowerCase();

export interface DecodedListing {
  listingId: number;
  itemId: number;
  owner: string;
  amount: number;
  pricePerItemWei: bigint;
  blockNumber: number;
}

export interface DecodedPurchase {
  transferId: string;
  listingId: number;
  buyer: string;
  quantity: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

export function decodeListing(log: ItemLog): DecodedListing {
  return {
    listingId: Number(BigInt(log.topics[1])),
    itemId: Number(BigInt(log.topics[2])),
    owner: addrFromTopic(log.topics[3]),
    amount: Number(word(log.data, 0)),
    pricePerItemWei: word(log.data, 1), // DATA WORD1 = pricePerItem (wei)
    blockNumber: Number(BigInt(log.blockNumber)),
  };
}

export function decodePurchase(log: ItemLog): DecodedPurchase {
  return {
    transferId: BigInt(log.topics[1]).toString(),
    listingId: Number(BigInt(log.topics[2])),
    buyer: addrFromTopic(log.topics[3]), // transferredTo = BUYER, never the seller
    quantity: Number(word(log.data, 0)),
    txHash: log.transactionHash.toLowerCase(),
    logIndex: Number(BigInt(log.logIndex)),
    blockNumber: Number(BigInt(log.blockNumber)),
  };
}

// eth_getLogs for one ItemMarket event over [from,to] with halve-on-cap: the RPC rejects
// >10000 results, so on any such error the window is split and retried until it fits.
export async function fetchItemLogs(topic0: string, fromBlock: bigint, toBlock: bigint): Promise<ItemLog[]> {
  if (fromBlock > toBlock) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [
        {
          address: ITEM_MARKET_CONTRACT as Hex,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [topic0 as Hex],
        },
      ],
    })) as unknown as ItemLog[];
  } catch (err) {
    if (toBlock - fromBlock < 1n) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const left = await fetchItemLogs(topic0, fromBlock, mid);
    const right = await fetchItemLogs(topic0, mid + 1n, toBlock);
    return [...left, ...right];
  }
}

// Block timestamp (unix seconds) for the 7d window. Fetched once per distinct purchase
// block, never per purchase.
export async function blockTimestamp(blockNumber: number): Promise<number | null> {
  try {
    const b = (await chainClient().request({
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false],
    })) as { timestamp: Hex } | null;
    return b ? Number(BigInt(b.timestamp)) : null;
  } catch {
    return null;
  }
}
