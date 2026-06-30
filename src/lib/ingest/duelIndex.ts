import type { Hex } from "viem";
import { setSyncState } from "../syncState";
import { chainClient, latestBlock } from "../chain";
import {
  DUELING_CONTRACT, DUELING_DEPLOY_CONFIG_BLOCK,
  TOPIC_LISTING_CREATED, TOPIC_DUEL_ENGAGED, TOPIC_OFFSPRING_MINTED, TOPIC_FALLEN, TOPIC_DUEL_RESOLVED, TOPIC_DUEL_RESTORED,
  decodeListingCreated, decodeDuelEngaged, decodeOffspringMinted, decodeFallen, decodeDuelResolved,
} from "../duel";
import { MAX_DUELS } from "../duelRules";

// Duel indexer: scans PetDuelingSystem from its first activity to head, building the duel global
// stats (duels resolved, Duelborn minted, challenge fees), the lineage (offspring -> parents ->
// owner), and a per-pet duels-left map (consumed a duel per resolution; a fallen pet is dead = 0).
// All stored in sync_state (no extra tables). Idempotent (recomputed each run from the full event
// set). Integer-wei. Read-only; never submits a tx.

export const DUEL_STATS_KEY = "duel_stats_v1";
const CHUNK = 9000n;

interface RawLog { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex }

async function fetchDuelLogs(from: bigint, to: bigint): Promise<RawLog[]> {
  if (from > to) return [];
  try {
    return (await chainClient().request({
      method: "eth_getLogs",
      params: [{ address: DUELING_CONTRACT as Hex, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
    })) as unknown as RawLog[];
  } catch (err) {
    if (to - from < 1n) throw err;
    const mid = from + (to - from) / 2n;
    return [...await fetchDuelLogs(from, mid), ...await fetchDuelLogs(mid + 1n, to)];
  }
}

export interface DuelLineageEntry { offspringPetId: number; parents: [number, number]; fallenPetId: number | null; owner: string; generation: number; listingId: number }

export interface DuelStatsSnapshot {
  duelsResolved: number; duelbornMinted: number; listingsCreated: number; duelsEngaged: number; restores: number;
  challengeFeesWei: string;
  lineage: DuelLineageEntry[];
  duelsLeftByPet: Record<string, number>;
  lastIndexedBlock: number; generatedAt: string;
}

export async function indexDuels(): Promise<DuelStatsSnapshot> {
  const head = Number(await latestBlock());
  const logs: RawLog[] = [];
  for (let cur = BigInt(DUELING_DEPLOY_CONFIG_BLOCK); cur <= BigInt(head); cur += CHUNK) {
    const end = cur + CHUNK - 1n > BigInt(head) ? BigInt(head) : cur + CHUNK - 1n;
    logs.push(...await fetchDuelLogs(cur, end));
  }

  let listingsCreated = 0, duelsEngaged = 0, duelsResolved = 0, duelbornMinted = 0, restores = 0;
  let feesWei = 0n;
  const lineage: DuelLineageEntry[] = [];
  const fallenByListing = new Map<string, string>();      // listingId -> fallen petId
  const duelsConsumed = new Map<number, number>();         // petId -> count of duels it took part in
  const fallenPets = new Set<number>();                    // pets that fell (dead)

  // First pass: collect fallen-by-listing (the Fallen event is the authoritative loser).
  for (const l of logs) {
    if (l.topics[0] === TOPIC_FALLEN) { const f = decodeFallen(l); fallenByListing.set(f.listingId, f.fallenPetId); fallenPets.add(Number(f.fallenPetId)); }
  }

  for (const l of logs) {
    switch (l.topics[0]) {
      case TOPIC_LISTING_CREATED: { const e = decodeListingCreated(l); listingsCreated++; feesWei += BigInt(e.priceWei); break; }
      case TOPIC_DUEL_ENGAGED: { const e = decodeDuelEngaged(l); duelsEngaged++; feesWei += BigInt(e.priceWei); break; }
      case TOPIC_DUEL_RESTORED: { restores++; break; }
      case TOPIC_OFFSPRING_MINTED: {
        const om = decodeOffspringMinted(l);
        duelbornMinted++;
        const pA = Number(om.parents[0]), pB = Number(om.parents[1]);
        duelsConsumed.set(pA, (duelsConsumed.get(pA) ?? 0) + 1);
        duelsConsumed.set(pB, (duelsConsumed.get(pB) ?? 0) + 1);
        break;
      }
      case TOPIC_DUEL_RESOLVED: {
        const dr = decodeDuelResolved(l);
        duelsResolved++;
        const fallen = fallenByListing.get(dr.listingId) ?? dr.fallenPetId;
        lineage.push({ offspringPetId: Number(dr.offspringPetId), parents: [Number(dr.parents[0]), Number(dr.parents[1])], fallenPetId: fallen != null ? Number(fallen) : null, owner: dr.owner, generation: dr.generation, listingId: Number(dr.listingId) });
        break;
      }
    }
  }

  // duels-left: a pet starts at MAX_DUELS, minus duels consumed; a fallen pet is dead (0).
  const duelsLeftByPet: Record<string, number> = {};
  for (const [petId, used] of duelsConsumed) duelsLeftByPet[petId] = fallenPets.has(petId) ? 0 : Math.max(0, MAX_DUELS - used);
  for (const petId of fallenPets) duelsLeftByPet[petId] = 0;

  const snapshot: DuelStatsSnapshot = {
    duelsResolved, duelbornMinted, listingsCreated, duelsEngaged, restores,
    challengeFeesWei: feesWei.toString(),
    lineage: lineage.sort((a, b) => b.offspringPetId - a.offspringPetId).slice(0, 200),
    duelsLeftByPet,
    lastIndexedBlock: head, generatedAt: new Date().toISOString(),
  };
  await setSyncState(DUEL_STATS_KEY, snapshot);
  return snapshot;
}
