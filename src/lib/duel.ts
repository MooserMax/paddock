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

// Real event topic0 hashes, now CONFIRMED by live on-chain occurrences (launch 2026-06).
export const TOPIC_LISTING_CREATED = "0x0e4ace6bb9078a99ba29fad8bf10bf777f3868b9ffd25701c704aab23ff4b684";
export const TOPIC_DUEL_ENGAGED = "0x5de4defb8c46fd170ca2bb84590c4ea8475cab0975fc9a94166c45965b1c3dc8";
export const TOPIC_DUEL_RESTORED = "0x021f0451973923311f81b1c20a7d2dee5534880a746cef4a2822c28523eb84f4";
export const TOPIC_OFFSPRING_MINTED = "0x898fb865cb813e0368a5968bde065dec2fdc002642f050c46b8303117e171f0e";

// Three more events that only appeared once duels happened, decoded from real resolution txs and
// cross-validated across multiple duels (and against the public listings API):
//   FALLEN (0xdcec): topic1 = the Gigling that FELL (the Fallen, becomes the Duelborn parent and
//     dies), topic2 = listingId. Fires once per resolution. This is the authoritative loser; the
//     offspring's gender is inherited from it with certainty (validated 8/8 vs real outcomes).
//   DUEL_RESOLVED (0xdd0b): topic1 = listingId; data = [fallenPetId, survivorPetId, offspringId,
//     owner, parent1, parent2, generation, randomSeed]. The full resolution summary.
//   GLUE_OR_RESTORE (0xafd0): topic1 = a small count/amount, topic2 = petId. Restore/glue-related
//     sub-event (fires alongside some DuelRestored); exact semantics still being confirmed.
//   PAYMENT (0x8728): topic1 = listingId, topic2 = address, data word0 = amount wei. A fee/payment
//     transfer event (small ETH amounts); fires rarely. Treated as a value event, not a duel core.
export const TOPIC_FALLEN = "0xdcec5b82f11ced23696788e67220727fb050fbbfa0e5975b61fc5f0a009922d8";
export const TOPIC_DUEL_RESOLVED = "0xdd0b8e7ff7dd71a448d311e606a6a20e4045d89cdadbcb605619b475d8ad01f9";
export const TOPIC_GLUE_OR_RESTORE = "0xafd0a85a3f09cebbc7d9fcde08e8a7d0ebb0aa7d768a030915c3816a053d3c7a";
export const TOPIC_PAYMENT = "0x87281cfb8e40c2dda93ceeedba58396deee5f792f163d4d2a688e471817f6371";

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

// OffspringMinted: topic1 offspringPetId, topic2 owner; data: [generation, parent1, parent2].
// NOTE: parent1/parent2 are in listing (host/challenger) order, NOT survivor/fallen order. The
// Fallen identity comes from TOPIC_FALLEN / the API loserPetId, never from this position.
export function decodeOffspringMinted(log: RawDuelLog): DecodedOffspringMinted {
  return {
    offspringPetId: BigInt(log.topics[1]).toString(),
    owner: addrFromTopic(log.topics[2]),
    generation: Number(word(log.data, 0)),
    parents: [word(log.data, 1).toString(), word(log.data, 2).toString()],
  };
}

// FALLEN: topic1 = fallen petId, topic2 = listingId. The authoritative loser of a duel.
export function decodeFallen(log: RawDuelLog): { fallenPetId: string; listingId: string } {
  return { fallenPetId: BigInt(log.topics[1]).toString(), listingId: BigInt(log.topics[2]).toString() };
}

export interface DecodedDuelResolved { listingId: string; fallenPetId: string; survivorPetId: string; offspringPetId: string; owner: string; parents: [string, string]; generation: number }

// DUEL_RESOLVED: topic1 = listingId; data = [fallen, survivor, offspring, owner, parent1, parent2, generation, seed].
export function decodeDuelResolved(log: RawDuelLog): DecodedDuelResolved {
  return {
    listingId: BigInt(log.topics[1]).toString(),
    fallenPetId: word(log.data, 0).toString(),
    survivorPetId: word(log.data, 1).toString(),
    offspringPetId: word(log.data, 2).toString(),
    owner: ("0x" + word(log.data, 3).toString(16).padStart(40, "0")).toLowerCase(),
    parents: [word(log.data, 4).toString(), word(log.data, 5).toString()],
    generation: Number(word(log.data, 6)),
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

// NOTE: the API's ?status= param is a no-op (it returns the same newest page regardless), so we
// must partition by phaseName ourselves: RESOLVED = completed, OPEN/READY = preparing (CANCELLED
// is neither). Verified live. cursor pagination DOES work (pageInfo.nextCursor).
export async function fetchDuelListings(opts: { cursor?: string; limit?: number } = {}): Promise<DuelListingsPage> {
  const params = new URLSearchParams();
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

export interface DuelFeed { preparing: DuelListing[]; completed: DuelListing[] }

// Gather up to `pages` pages (newest first), dedup by listingId, and partition by on-chain phase:
// completed = RESOLVED (has a Duelborn); preparing = OPEN or READY (unresolved). Server-side.
export async function fetchDuelFeed(pages = 3): Promise<DuelFeed> {
  const byId = new Map<number, DuelListing>();
  let cursor: string | undefined;
  for (let i = 0; i < pages; i++) {
    const page = await fetchDuelListings({ cursor, limit: 20 });
    for (const l of page.listings) {
      const idRaw = (l as { listingId?: number }).listingId;
      if (typeof idRaw === "number" && !byId.has(idRaw)) byId.set(idRaw, l);
    }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const all = [...byId.values()].sort((a, b) => Number((b as { listingId?: number }).listingId ?? 0) - Number((a as { listingId?: number }).listingId ?? 0));
  const phase = (l: DuelListing) => String((l as { phaseName?: string }).phaseName ?? "").toUpperCase();
  return {
    completed: all.filter((l) => phase(l) === "RESOLVED"),
    preparing: all.filter((l) => phase(l) === "OPEN" || phase(l) === "READY"),
  };
}
