import { createPublicClient, http, decodeAbiParameters, type PublicClient, type Hex } from "viem";
import { optionalEnv } from "./env";

// The racing contract. Discovered empirically: every race-creation and
// race-broadcast tx targets this address and it emits the racing events.
// (0xd320...75b1 mentioned around the ecosystem is GigaPetNFT, the ERC-721.)
export const RACING_CONTRACT = "0x16e0b3d6394ce7597d34b73f5e5fb165fd74394e";
export const GIGAPET_NFT = "0xd320831c876190c7ef79376ffcc889756f038e04";

// Race 1 was created in block 67,599,042 (tx 0x80bcdc5e...). Scanning starts
// just below it so the very first events are inside the first window.
export const RACING_START_BLOCK = 67_598_000n;

// Verified against live logs:
// - RACE_CREATED fires once per race creation with topic1 = raceId.
//   Full parameter list is unknown, but only the raceId is needed; details
//   are hydrated from the public race API.
// - RACE_RESOLVED is keccak("RaceResolved(uint256,uint256[],uint256[],uint256[],uint256[])")
//   with topic1 = raceId (indexed) and data = (finishOrderPetIds, finishTimesMs,
//   unused, unused). Decode verified against /api/racing/race/{id} for races 1 and 4000.
export const TOPIC_RACE_CREATED =
  "0x6ba8300c6b71e5709b9f114f7522ac8c31ada85783b0c40d18eb76a6ba995f9b";
export const TOPIC_RACE_RESOLVED =
  "0xfd6f2ec0d5b0c729a44291652465b5fbd261acb855f8980662e847fb5a7f7469";

export const DEFAULT_RPC_URL = "https://api.mainnet.abs.xyz";

let client: PublicClient | null = null;

export function chainClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      transport: http(optionalEnv("RPC_URL") ?? DEFAULT_RPC_URL, {
        retryCount: 3,
        retryDelay: 1000,
      }),
    });
  }
  return client;
}

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
}

export interface RaceCreated {
  kind: "created";
  raceId: bigint;
  blockNumber: bigint;
}

export interface RaceResolved {
  kind: "resolved";
  raceId: bigint;
  blockNumber: bigint;
  finishOrder: bigint[];
  finishTimesMs: bigint[];
}

export type RacingEvent = RaceCreated | RaceResolved;

export function decodeRacingLog(log: RawLog): RacingEvent | null {
  const raceId = BigInt(log.topics[1] ?? 0n);
  const blockNumber = BigInt(log.blockNumber);
  if (log.topics[0] === TOPIC_RACE_CREATED) {
    return { kind: "created", raceId, blockNumber };
  }
  if (log.topics[0] === TOPIC_RACE_RESOLVED) {
    const [finishOrder, finishTimesMs] = decodeAbiParameters(
      [
        { type: "uint256[]" },
        { type: "uint256[]" },
        { type: "uint256[]" },
        { type: "uint256[]" },
      ],
      log.data
    );
    return {
      kind: "resolved",
      raceId,
      blockNumber,
      finishOrder: [...finishOrder],
      finishTimesMs: [...finishTimesMs],
    };
  }
  return null;
}

// eth_getLogs over a block range, splitting the range in half whenever the
// RPC rejects it (result cap or range cap), down to a 200-block floor.
export async function fetchRacingLogs(
  fromBlock: bigint,
  toBlock: bigint
): Promise<RawLog[]> {
  if (fromBlock > toBlock) return [];
  try {
    const logs = (await chainClient().request({
      method: "eth_getLogs",
      params: [
        {
          address: RACING_CONTRACT as Hex,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [[TOPIC_RACE_CREATED, TOPIC_RACE_RESOLVED]],
        },
      ],
    })) as RawLog[];
    return logs;
  } catch (err) {
    if (toBlock - fromBlock < 200n) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const left = await fetchRacingLogs(fromBlock, mid);
    const right = await fetchRacingLogs(mid + 1n, toBlock);
    return [...left, ...right];
  }
}

export async function latestBlock(): Promise<bigint> {
  return chainClient().getBlockNumber();
}
