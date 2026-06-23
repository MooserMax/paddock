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
