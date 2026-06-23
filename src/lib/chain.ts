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

// The live PetRacingSystem. Current racing (creation, config, joins, resolution)
// emits here; the historical RACING_CONTRACT above stopped emitting after a
// contract migration, so live forming-lobby reads target this address instead.
// Every topic and field below was decoded from real logs and cross-checked
// against /api/racing/race/{id} for live races (see src/lib/lobbies.ts).
export const PETRACING_CONTRACT = "0xf6ed2a53f311352c869e268601aae5b78b9a9650";

// Additional event topics on PETRACING_CONTRACT, beyond CREATED/RESOLVED above:
// - RACE_CONFIG fires once per race at creation. topic1 = raceId (indexed),
//   topic2 = creator (indexed); data = [fieldSize, trackLength, ...]. Verified:
//   data word 0 == fieldSize and word 1 == trackLength on every sampled race.
// - RACE_JOINED fires once per entrant, in slot order. topic1 = raceId,
//   topic2 = petId, topic3 = owner (all indexed); no data. This is how a forming
//   field populates as horses enter.
// RACE_CREATED (TOPIC_RACE_CREATED) additionally carries payoutBps in its data
// as the first uint256[] of the tuple (uint256[], uint256, uint256[], uint256[]).
export const TOPIC_RACE_CONFIG =
  "0x3140283acc902bb8af484fc157968628a25250c6f6f93ad8d07a0aeb674b3d28";
export const TOPIC_RACE_JOINED =
  "0xa5b60649bd7726669cdec0e1f69faf3e3533ba803f6660b010e91325a0311751";

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

// eth_getLogs for the live PetRacingSystem lobby events (created, config, joined,
// resolved) over a block range, with the same halve-on-rejection fallback as
// fetchRacingLogs. A single forming-lobby refresh is one of these calls over only
// the blocks added since the last cursor, so the steady-state cost is one RPC call.
export async function fetchLobbyLogs(
  fromBlock: bigint,
  toBlock: bigint
): Promise<RawLog[]> {
  if (fromBlock > toBlock) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [
        {
          address: PETRACING_CONTRACT as Hex,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [[TOPIC_RACE_CREATED, TOPIC_RACE_CONFIG, TOPIC_RACE_JOINED, TOPIC_RACE_RESOLVED]],
        },
      ],
    })) as RawLog[];
  } catch (err) {
    if (toBlock - fromBlock < 200n) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const left = await fetchLobbyLogs(fromBlock, mid);
    const right = await fetchLobbyLogs(mid + 1n, toBlock);
    return [...left, ...right];
  }
}

// Standard ERC-721 Transfer(address indexed from, address indexed to, uint256
// indexed tokenId). Used to keep pet ownership in sync with on-chain reality.
export const TOPIC_ERC721_TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// eth_getLogs for Giglings NFT Transfer events over a block range, with the same
// halve-on-rejection fallback as the racing log readers. A pet's owner is whatever
// address received the most recent Transfer of its token id.
export async function fetchTransferLogs(
  fromBlock: bigint,
  toBlock: bigint
): Promise<RawLog[]> {
  if (fromBlock > toBlock) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [
        {
          address: GIGAPET_NFT as Hex,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [[TOPIC_ERC721_TRANSFER]],
        },
      ],
    })) as RawLog[];
  } catch (err) {
    if (toBlock - fromBlock < 200n) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const left = await fetchTransferLogs(fromBlock, mid);
    const right = await fetchTransferLogs(mid + 1n, toBlock);
    return [...left, ...right];
  }
}

export async function latestBlock(): Promise<bigint> {
  return chainClient().getBlockNumber();
}
