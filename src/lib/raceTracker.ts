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

// ---- Direct on-chain resolution check (so the flip rides chain, not the ingest cron) -
// The PetRacingSystem emits a race-state event: topic1 = raceId, data word = phase.
// phase 3 = RESOLVED on-chain. We use it to mark a still-pending race FINISHED the
// moment it resolves, ahead of Paddock's resolved-race ingest. Verified on race 14890
// (data 0x..0002 forming, then 0x..0003 resolved).
const TOPIC_RACE_STATE = "0xa92c850bb09d5afa4a6230f4866fad10264c6fea20047156b39e3e24c5763ad4";

// Resolution is terminal, so a race once seen at phase 3 is cached and never re-queried.
// This is the brief cache that keeps the 20s poll from re-hitting the RPC for the same
// race; the positive set is bounded so it cannot grow without limit.
const phase3Cache = new Set<number>();

async function stateLogs(lo: bigint, hi: bigint, idTopics: Hex[]): Promise<{ topics: string[]; data: string }[]> {
  if (lo > hi) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [{ address: PETRACING_CONTRACT as Hex, fromBlock: `0x${lo.toString(16)}`, toBlock: `0x${hi.toString(16)}`, topics: [TOPIC_RACE_STATE, idTopics] }],
    })) as { topics: string[]; data: string }[];
  } catch (err) {
    if (hi - lo < 500n) throw err;
    const mid = lo + (hi - lo) / 2n;
    const [a, b] = await Promise.all([stateLogs(lo, mid, idTopics), stateLogs(mid + 1n, hi, idTopics)]);
    return [...a, ...b];
  }
}

// Which of `raceIds` are RESOLVED on-chain (race-state phase 3) within the bounded
// window. ONE topic-filtered eth_getLogs over only the still-pending raceIds (the
// resolved ones are already settled via the DB), with a terminal positive cache. A
// failed RPC read just leaves them LIVE this cycle, never falsely FINISHED. Read-only.
export async function resolvedOnChain(raceIds: number[], head: number, windowBlocks: number): Promise<Set<number>> {
  const resolved = new Set<number>();
  const toCheck: number[] = [];
  for (const id of raceIds) {
    if (phase3Cache.has(id)) resolved.add(id);
    else toCheck.push(id);
  }
  if (toCheck.length === 0) return resolved;

  const hi = BigInt(head);
  const lo = hi - BigInt(windowBlocks) > 0n ? hi - BigInt(windowBlocks) : 0n;
  const idTopics = toCheck.map((id) => (`0x${id.toString(16).padStart(64, "0")}`) as Hex);
  let logs: { topics: string[]; data: string }[] = [];
  try {
    logs = await stateLogs(lo, hi, idTopics);
  } catch {
    return resolved; // leave pending races LIVE this cycle rather than guess
  }
  for (const l of logs) {
    // The first data word is the phase; 3 = resolved.
    const phase = Number(BigInt("0x" + (l.data.slice(2, 66) || "0")));
    if (phase === 3) {
      const id = Number(BigInt(l.topics[1]));
      resolved.add(id);
      if (phase3Cache.size < 10_000) phase3Cache.add(id);
    }
  }
  return resolved;
}
