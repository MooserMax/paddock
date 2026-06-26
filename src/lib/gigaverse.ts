// Polite client for the public Gigaverse API. Small batches, spaced requests,
// exponential backoff. Gigaverse encourages data use; we repay that by never
// hammering them.

const BASE = "https://gigaverse.io/api";

export const PETS_BATCH_SIZE = 25;
export const REQUEST_GAP_MS = 500;
const MAX_ATTEMPTS = 5;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gigaFetch<T>(path: string): Promise<T> {
  let lastError: unknown = null;
  let backoff = 1000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`Gigaverse API ${res.status} for ${path} (not retryable)`);
      }
      lastError = new Error(`Gigaverse API ${res.status} for ${path}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("not retryable")) throw err;
      lastError = err;
    }
    await sleep(backoff);
    backoff *= 2;
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Gigaverse API failed for ${path}`);
}

export interface GigaTrait {
  id: string;
  name: string;
  tier: number | null;
}

export interface GigaStatRange {
  min: number;
  max: number;
}

export interface GigaRacePublic {
  id: number;
  racesRun: number;
  maxRaces: number;
  revealsPerStat: { start: number; speed: number; stamina: number; finish: number };
  startRange: GigaStatRange;
  speedRange: GigaStatRange;
  staminaRange: GigaStatRange;
  finishRange: GigaStatRange;
  traits: GigaTrait[];
  elo: number;
  eloRaceCount: number;
  wins: number;
}

export interface GigaPet {
  id: number;
  ownerAddress: string;
  name: string;
  imgUrl: string;
  hatched: boolean;
  // On-chain racing registration. A Gigling can be hatched (metadata) yet NOT
  // registered for racing on-chain; joinRace reverts PetNotHatched (0x8d28823d) for
  // these, so they are not actually raceable. This is the authoritative racing-eligibility
  // gate that canPetRace does NOT check.
  isRegisteredOnChain?: boolean;
  gender: string;
  rarity: number;
  rarityName: string;
  faction: number;
  factionName: string;
  racePublic?: GigaRacePublic;
}

export interface GigaRaceEntry {
  petId: number;
  ownerAddress: string;
  slot: number;
  joinedAt: number;
  juiced: boolean;
}

export interface GigaPetPayout {
  amount: string;
  raceAmount: string;
  jackpotAmount: string;
  claimed: boolean;
  rank: number;
  payoutKind: string;
}

export interface GigaRace {
  success: boolean;
  raceId: number;
  phase: number;
  fieldSize: number;
  trackLength: number;
  raceStart: number;
  entryFee: string;
  pool?: string | number;
  creator: string;
  racePets: number[];
  petOwners: Record<string, string>;
  entries: GigaRaceEntry[];
  finalRanking: number[];
  finishTimes: number[];
  payoutBps: number[];
  creatorFeeBps: number;
  protocolFeeBps: number;
  protocolFeeBpsJuiced: number;
  jackpotBps: number;
  petPayouts: Record<string, GigaPetPayout>;
  raceTemp: string;
}

export interface GigaAccount {
  primaryUsername?: string;
}

// Nonexistent ids are silently omitted from the response.
export async function fetchPetsBatch(ids: number[]): Promise<GigaPet[]> {
  if (ids.length === 0) return [];
  if (ids.length > PETS_BATCH_SIZE) {
    throw new Error(`Pet batch too large: ${ids.length} > ${PETS_BATCH_SIZE}`);
  }
  const res = await gigaFetch<{ success: boolean; pets: GigaPet[] }>(
    `/racing/pets?ids=${ids.join(",")}`
  );
  return res.pets ?? [];
}

export async function fetchRace(raceId: number): Promise<GigaRace> {
  return gigaFetch<GigaRace>(`/racing/race/${raceId}`);
}

export async function fetchAccount(address: string): Promise<GigaAccount> {
  return gigaFetch<GigaAccount>(`/account/${address}`);
}
