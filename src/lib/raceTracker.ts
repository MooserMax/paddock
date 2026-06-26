import { chainClient, latestBlock, PETRACING_CONTRACT, TOPIC_RACE_JOINED } from "./chain";
import type { Hex } from "viem";

// Race discovery for the follow-your-entry view. Mechanism (b): find the most
// recent race the connected wallet's pets are in, by reading RACE_JOINED logs
// filtered to this owner (topic3) on the free Abstract RPC. This is general, it
// catches a race entered anywhere (in game, dagrid, or Paddock), not only one the
// user just entered through Paddock, so the tracker works for any connected wallet.
// Bounded and polite: a topic-filtered eth_getLogs over a small backward window,
// stopping as soon as the most recent join is found.

const CHUNK = 20_000n; // ~2.8h per scan
const MAX_LOOKBACK = 120_000n; // ~17h total before giving up

function ownerTopic(addr: string): Hex {
  return ("0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "")) as Hex;
}

export async function findMyRace(wallet: string): Promise<{ raceId: number; petId: number } | null> {
  const owner = ownerTopic(wallet);
  const head = await latestBlock();
  // Scan newest first so we return as soon as a recent join is found.
  for (let hi = head; hi > head - MAX_LOOKBACK && hi > 0n; hi -= CHUNK) {
    const lo = hi - CHUNK + 1n > 0n ? hi - CHUNK + 1n : 0n;
    let logs: { topics: string[]; blockNumber: string }[] = [];
    try {
      logs = (await chainClient().request({
        method: "eth_getLogs",
        params: [{ address: PETRACING_CONTRACT as Hex, fromBlock: `0x${lo.toString(16)}`, toBlock: `0x${hi.toString(16)}`, topics: [TOPIC_RACE_JOINED, null, null, owner] }],
      })) as { topics: string[]; blockNumber: string }[];
    } catch {
      continue; // a rejected range just means try the next window
    }
    if (logs.length === 0) continue;
    // Most recent by block, then highest raceId, is the race to track.
    logs.sort((a, b) => {
      const ab = Number(BigInt(b.blockNumber)) - Number(BigInt(a.blockNumber));
      return ab !== 0 ? ab : Number(BigInt(b.topics[1])) - Number(BigInt(a.topics[1]));
    });
    const top = logs[0];
    return { raceId: Number(BigInt(top.topics[1])), petId: Number(BigInt(top.topics[2])) };
  }
  return null;
}

// ---- Live-races tracker: ALL of a wallet's recent joins (not just the latest) -----
// The in-flight tracker needs every race the wallet joined in a bounded recent window,
// so it can show each as LIVE until Paddock's DB has it resolved. One topic-filtered
// (owner) eth_getLogs over the window; the indexed topics mean the RPC returns only
// this wallet's joins (a handful), so it stays cheap even over a wide window.
const LIVE_LOOKBACK_BLOCKS = 20_000n; // ~2.8h on Abstract (~0.5s/block): covers the 1h open-expiry plus recently finished, then ages old joins out so nothing shows LIVE forever.

async function joinedLogsByOwner(lo: bigint, hi: bigint, owner: Hex): Promise<{ topics: string[]; blockNumber: string }[]> {
  if (lo > hi) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [{ address: PETRACING_CONTRACT as Hex, fromBlock: `0x${lo.toString(16)}`, toBlock: `0x${hi.toString(16)}`, topics: [TOPIC_RACE_JOINED, null, null, owner] }],
    })) as { topics: string[]; blockNumber: string }[];
  } catch (err) {
    // Halve on an RPC range/result rejection, down to a small floor, then rethrow.
    if (hi - lo < 500n) throw err;
    const mid = lo + (hi - lo) / 2n;
    const [a, b] = await Promise.all([joinedLogsByOwner(lo, mid, owner), joinedLogsByOwner(mid + 1n, hi, owner)]);
    return [...a, ...b];
  }
}

export interface JoinedRaceLog { raceId: number; petId: number; block: number; }

// All RACE_JOINED logs for `wallet` in the bounded lookback window, plus the head block
// (so the caller can reason about age). Read-only: eth_getLogs only, no writes.
export async function findMyJoinedRaces(wallet: string): Promise<{ races: JoinedRaceLog[]; head: number; windowBlocks: number }> {
  const owner = ownerTopic(wallet);
  const head = await latestBlock();
  const lo = head - LIVE_LOOKBACK_BLOCKS > 0n ? head - LIVE_LOOKBACK_BLOCKS : 0n;
  const logs = await joinedLogsByOwner(lo, head, owner);
  return {
    head: Number(head),
    windowBlocks: Number(LIVE_LOOKBACK_BLOCKS),
    races: logs.map((l) => ({ raceId: Number(BigInt(l.topics[1])), petId: Number(BigInt(l.topics[2])), block: Number(BigInt(l.blockNumber)) })),
  };
}
