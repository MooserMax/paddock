import { chainClient, PETRACING_CONTRACT } from "./chain";

// Authoritative per-pet race status, read from the PetRacingSystem contract.
//
// The game's "x/2" daily counter is NOT in the public racing/pets endpoint (that
// carries only LIFETIME racesRun and a cooldownEnd). The game renders eligibility
// from the contract, which is the source of truth and what we read here.
//
//  - canPetRace(petId, owner) -> bool is the contract's own "can this pet enter a
//    race right now" view. It applies the real per-pet daily cap (getDailyRaceLimits
//    = 2 unjuiced / 3 juiced) over the real reset cycle (the contract buckets by
//    cycleDay = floor(unixTime / 86400)), so it is juiced-aware and needs NO reset
//    formula on our side. Verified live against the game and across the cap.
//  - isPetLocked(petId) -> bool is true while a pet is in a race. canPetRace also
//    returns false when locked, so we read BOTH to tell the two states apart:
//    locked  => racing (busy now), NOT locked + cannot race => resting (daily limit).
//
// This replaces the previous trailing-24h RACE_JOINED count, which did not match the
// game's reset and wrongly marked ready horses (4967 at 1/2, 8367 at 0/2) as resting.
// We do not invent a reset rule; we read the contract's own verdict.

const STATUS_ABI = [
  {
    name: "canPetRace",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "petId", type: "uint256" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isPetLocked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "petId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface PetRaceStatus {
  canRace: boolean; // contract says this pet may enter a race now
  locked: boolean; // pet is currently in a race
}

// Brief per-pet cache so the 4s lobby poll does not re-read the contract every cycle.
// Eligibility only changes when a pet races or the daily cycle rolls, so a short TTL
// is plenty and keeps the read off the hot path. Keyed by petId (a pet has one owner;
// callers pass that owner).
const TTL_MS = 30_000;
interface Entry extends PetRaceStatus {
  at: number;
}
const cache = new Map<number, Entry>();

// Authoritative status for each pet. owner is the address that holds these pets (all
// candidates in a query share one owner). A pet whose reads failed is simply absent
// from the returned map; callers MUST treat "absent" as unknown and never hide it, so
// a transient RPC error can never strand an eligible horse.
export async function petRaceStatus(petIds: number[], owner: string | null): Promise<Map<number, PetRaceStatus>> {
  const out = new Map<number, PetRaceStatus>();
  if (!owner || petIds.length === 0) return out;

  const now = Date.now();
  const stale = petIds.filter((id) => {
    const c = cache.get(id);
    return !c || now - c.at >= TTL_MS;
  });

  if (stale.length) {
    const client = chainClient();
    const reads = await Promise.all(
      stale.map(async (id) => {
        try {
          const [canRace, locked] = await Promise.all([
            client.readContract({ address: PETRACING_CONTRACT as `0x${string}`, abi: STATUS_ABI, functionName: "canPetRace", args: [BigInt(id), owner as `0x${string}`] }),
            client.readContract({ address: PETRACING_CONTRACT as `0x${string}`, abi: STATUS_ABI, functionName: "isPetLocked", args: [BigInt(id)] }),
          ]);
          return { id, canRace: canRace as boolean, locked: locked as boolean };
        } catch {
          return null; // leave this pet unknown rather than guessing
        }
      })
    );
    for (const r of reads) if (r) cache.set(r.id, { canRace: r.canRace, locked: r.locked, at: now });
  }

  for (const id of petIds) {
    const c = cache.get(id);
    if (c) out.set(id, { canRace: c.canRace, locked: c.locked });
  }
  return out;
}
