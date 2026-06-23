import { db } from "../db";
import { fetchTransferLogs, latestBlock } from "../chain";
import { getSyncState, setSyncState } from "../syncState";

// Keep pet ownership in sync with on-chain reality. A pet's owner_address is
// otherwise only written by the pet sync (pets.ts), which refreshes a pet when it
// races, when it is a new-mint probe, or when the slow full-population sweep reaches
// it. A transfer alone triggers none of those, so a transferred-but-not-raced
// Gigling keeps its previous owner_address and never shows up for its new owner, and
// the roster query (pets WHERE owner_address = wallet) cannot find it.
//
// This reads ERC-721 Transfer logs from the Giglings NFT incrementally from a
// persisted block cursor, the same free-RPC eth_getLogs pattern records and lobbies
// use, and sets owner_address to the current holder. General: ANY transferred pet is
// corrected within one cron cycle, independent of racing. Idempotent, and updates
// only pets we already track (an unknown pet is picked up by the normal pet sync
// with the correct owner). Transfers are rare (roughly one per few hours), so the
// steady-state cost is a single small eth_getLogs per cycle.

const STATE_KEY = "pet_transfers_scan";
// Abstract blocks are ~0.5s. On a cold start, look back far enough to correct pets
// transferred in the recent past in one pass; after that the cursor only scans new
// blocks. Window equals the lookback so the first run covers it whole.
const COLD_LOOKBACK = 250_000n; // ~35 hours
const MAX_WINDOW = 250_000n; // fetchTransferLogs halves on rejection if the RPC caps the range

function topicAddr(t: string | undefined): string | null {
  return t ? ("0x" + t.slice(-40)).toLowerCase() : null;
}
function topicTokenId(t: string | undefined): number | null {
  if (!t) return null;
  const n = BigInt(t);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}

export interface PetTransferResult {
  fromBlock: string;
  toBlock: string;
  caughtUp: boolean;
  transfers: number; // Transfer logs seen in this window
  updated: number; // tracked pets whose owner_address changed
}

export async function scanPetTransfers(): Promise<PetTransferResult> {
  const head = await latestBlock();
  const state = await getSyncState<{ lastBlock: string }>(STATE_KEY);
  const startBlock = state ? BigInt(state.lastBlock) + 1n : (head - COLD_LOOKBACK > 0n ? head - COLD_LOOKBACK : 0n);
  if (startBlock > head) {
    return { fromBlock: startBlock.toString(), toBlock: head.toString(), caughtUp: true, transfers: 0, updated: 0 };
  }
  const windowEnd = startBlock + MAX_WINDOW - 1n > head ? head : startBlock + MAX_WINDOW - 1n;

  const logs = await fetchTransferLogs(startBlock, windowEnd);

  // The most recent Transfer of a token id in this window wins, so a mint followed
  // by a sale resolves to the final holder.
  const ordered = [...logs].sort((a, b) => {
    const ab = Number(BigInt(a.blockNumber)) - Number(BigInt(b.blockNumber));
    return ab !== 0 ? ab : Number(BigInt((a as unknown as { logIndex?: string }).logIndex ?? "0x0")) - Number(BigInt((b as unknown as { logIndex?: string }).logIndex ?? "0x0"));
  });
  const latestOwner = new Map<number, string>();
  for (const log of ordered) {
    const tokenId = topicTokenId(log.topics[3]);
    const to = topicAddr(log.topics[2]);
    if (tokenId == null || !to) continue;
    latestOwner.set(tokenId, to);
  }

  // Update only tracked pets whose owner actually changed. neq keeps this a no-op
  // when nothing moved; count tells us how many rows changed.
  let updated = 0;
  for (const [tokenId, owner] of latestOwner) {
    const { error, count } = await db()
      .from("pets")
      .update({ owner_address: owner }, { count: "exact" })
      .eq("id", tokenId)
      .neq("owner_address", owner);
    if (error) throw new Error(`pet owner update failed: ${error.message}`);
    if (count) updated += count;
  }

  await setSyncState(STATE_KEY, { lastBlock: windowEnd.toString() });
  return {
    fromBlock: startBlock.toString(),
    toBlock: windowEnd.toString(),
    caughtUp: windowEnd >= head,
    transfers: latestOwner.size,
    updated,
  };
}
