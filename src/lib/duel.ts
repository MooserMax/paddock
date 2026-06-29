import type { Hex } from "viem";

// Gigaverse Dueling (breeding-via-combat). PREVIEW shipped; actions unlock at launch. This is
// the verified data layer: the real on-chain ABI/events (extracted from the live /duel client
// bundle, source below), the config + listings readers, and decode helpers that are READY so the
// moment the first real duel posts, Paddock indexes it. Read-only; we never submit a duel tx.
//
// SOURCE of the ABI/constants: gigaverse.io /duel client chunk (the PetDuelingSystem contract
// definition and the duel Info-tab ruleset are embedded there), plus GET /api/contracts (address
// registry), GET /api/duel/config (live config). Addresses are the authoritative /api/contracts
// values.

export const DUELING_CONTRACT = "0x441b1536e31a750b6f07471201a9007e26288616"; // PetDuelingSystem
export const DUELING_DEPLOY_CONFIG_BLOCK = 72_007_724; // first admin/config event (no real duels yet)

// Verified config (GET /api/duel/config is authoritative; the UI bundle also carries these).
export const MIN_RACES_TO_DUEL = 40;
export const MAX_DUELS = 3;
export const MAX_DUEL_RESTORES = 3;

// Real event topic0 hashes (keccak of the canonical signatures from the extracted ABI). The
// indexer watches these; they exist NOW (no need to wait for the first tx to learn them).
export const TOPIC_LISTING_CREATED = "0x0e4ace6bb9078a99ba29fad8bf10bf777f3868b9ffd25701c704aab23ff4b684";
export const TOPIC_DUEL_ENGAGED = "0x5de4defb8c46fd170ca2bb84590c4ea8475cab0975fc9a94166c45965b1c3dc8";
export const TOPIC_DUEL_RESTORED = "0x021f0451973923311f81b1c20a7d2dee5534880a746cef4a2822c28523eb84f4";
export const TOPIC_OFFSPRING_MINTED = "0x898fb865cb813e0368a5968bde065dec2fdc002642f050c46b8303117e171f0e";

// The real PetDuelingSystem ABI (human-readable), extracted verbatim from the /duel bundle.
export const PET_DUELING_ABI = [
  "function createListing(uint256 petId, uint8 template, uint256 aggressionBps, uint256 priceWei, uint256[] extraParamIds, uint256[] extraParamVals) returns (uint256 listingId)",
  "function cancelListing(uint256 listingId)",
  "function engageDuel(uint256 listingId, uint256 challengerPetId, uint256 deadline, uint256 nonce, bytes signature) payable",
  "function duelOwnedPets(uint256 hostPetId, uint256 challengerPetId, uint8 template, uint256 aggressionBps, uint256 deadline, uint256 nonce, bytes signature, uint256[] extraParamIds, uint256[] extraParamVals) returns (uint256 listingId)",
  "function resolveDuel(uint256 listingId, uint256 loserPetId, address offspringOwner, uint256 randomSeed, uint8 offspringRarity, uint256[] extraParamIds, uint256[] extraParamVals) returns (uint256 offspringPetId)",
  "function restoreDuel(uint256 petId, uint256[] glueItemIds, uint256[] glueAmounts, uint256 nonce, uint256 deadline, bytes restoreSignature, bytes importExportSignature)",
  "function getPetDuelsLeft(uint256 petId) view returns (uint256)",
  "function getPetRestoresUsed(uint256 petId) view returns (uint256)",
  "function getAuthSigner() view returns (address)",
  "event ListingCreated(uint256 indexed listingId, uint256 indexed hostPetId, address indexed host, uint8 template, uint256 aggressionBps, uint256 priceWei)",
  "event DuelEngaged(uint256 indexed listingId, uint256 indexed challengerPetId, address indexed challenger, uint256 priceWei)",
  "event DuelRestored(uint256 indexed petId, uint256 restoresUsed)",
  "event OffspringMinted(uint256 indexed offspringPetId, address indexed owner, uint256 generation, uint256[2] parents)",
] as const;

// Decoded forms the launch-time indexer will store (priceWei kept as a string for integer-wei).
export interface DecodedListingCreated { listingId: string; hostPetId: string; host: string; template: number; aggressionBps: number; priceWei: string }
export interface DecodedDuelEngaged { listingId: string; challengerPetId: string; challenger: string; priceWei: string }
export interface DecodedOffspringMinted { offspringPetId: string; owner: string; generation: number; parents: [string, string] }

const word = (data: string, i: number): bigint => BigInt("0x" + data.slice(2 + i * 64, 2 + (i + 1) * 64));
const addrFromTopic = (t: string): string => ("0x" + t.slice(26)).toLowerCase();

interface RawDuelLog { topics: Hex[]; data: Hex }

// ListingCreated: topic1 listingId, topic2 hostPetId, topic3 host; data: template, aggressionBps, priceWei.
export function decodeListingCreated(log: RawDuelLog): DecodedListingCreated {
  return {
    listingId: BigInt(log.topics[1]).toString(),
    hostPetId: BigInt(log.topics[2]).toString(),
    host: addrFromTopic(log.topics[3]),
    template: Number(word(log.data, 0)),
    aggressionBps: Number(word(log.data, 1)),
    priceWei: word(log.data, 2).toString(),
  };
}

// DuelEngaged: topic1 listingId, topic2 challengerPetId, topic3 challenger; data: priceWei.
export function decodeDuelEngaged(log: RawDuelLog): DecodedDuelEngaged {
  return {
    listingId: BigInt(log.topics[1]).toString(),
    challengerPetId: BigInt(log.topics[2]).toString(),
    challenger: addrFromTopic(log.topics[3]),
    priceWei: word(log.data, 0).toString(),
  };
}

// OffspringMinted: topic1 offspringPetId, topic2 owner; data: generation, parents[2].
export function decodeOffspringMinted(log: RawDuelLog): DecodedOffspringMinted {
  return {
    offspringPetId: BigInt(log.topics[1]).toString(),
    owner: addrFromTopic(log.topics[2]),
    generation: Number(word(log.data, 0)),
    parents: [word(log.data, 1).toString(), word(log.data, 2).toString()],
  };
}

// ---- Live preview APIs (read-only, server-side, cached) --------------------

export interface DuelConfig { maxDuels: number; minRacesToDuel: number; maxDuelRestores: number }
export interface DuelListing { [k: string]: unknown }
export interface DuelListingsPage { listings: DuelListing[]; hasMore: boolean; nextCursor: string | null }

export async function fetchDuelConfig(): Promise<DuelConfig | null> {
  try {
    const res = await fetch("https://gigaverse.io/api/duel/config", { headers: { accept: "application/json" }, next: { revalidate: 600 } });
    if (!res.ok) return null;
    const b = (await res.json()) as { success?: boolean; maxDuels?: number; minRacesToDuel?: number; maxDuelRestores?: number };
    if (!b.success) return null;
    return { maxDuels: b.maxDuels ?? MAX_DUELS, minRacesToDuel: b.minRacesToDuel ?? MIN_RACES_TO_DUEL, maxDuelRestores: b.maxDuelRestores ?? MAX_DUEL_RESTORES };
  } catch {
    return null;
  }
}

// status: undefined | "preparing" | "completed". Empty now (no duels yet); renders gracefully.
export async function fetchDuelListings(opts: { status?: "preparing" | "completed"; cursor?: string; limit?: number } = {}): Promise<DuelListingsPage> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.cursor) params.set("cursor", opts.cursor);
  params.set("limit", String(Math.min(20, Math.max(1, opts.limit ?? 20))));
  try {
    const res = await fetch(`https://gigaverse.io/api/duel/listings?${params}`, { headers: { accept: "application/json" }, next: { revalidate: 30 } });
    if (!res.ok) return { listings: [], hasMore: false, nextCursor: null };
    const b = (await res.json()) as { success?: boolean; listings?: DuelListing[]; pageInfo?: { hasMore?: boolean; nextCursor?: string | null } };
    return { listings: b.listings ?? [], hasMore: !!b.pageInfo?.hasMore, nextCursor: b.pageInfo?.nextCursor ?? null };
  } catch {
    return { listings: [], hasMore: false, nextCursor: null };
  }
}
