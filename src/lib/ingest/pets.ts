import { db } from "../db";
import {
  fetchPetsBatch,
  GigaPet,
  PETS_BATCH_SIZE,
  REQUEST_GAP_MS,
  sleep,
} from "../gigaverse";

function petRow(pet: GigaPet) {
  const rp = pet.racePublic;
  return {
    id: pet.id,
    owner_address: pet.ownerAddress?.toLowerCase() ?? null,
    name: pet.name ?? null,
    img_url: pet.imgUrl ?? null,
    hatched: pet.hatched ?? false,
    gender: pet.gender || null,
    rarity: pet.rarity ?? null,
    rarity_name: pet.rarityName ?? null,
    faction: pet.faction ?? null,
    faction_name: pet.factionName ?? null,
    races_run: rp?.racesRun ?? null,
    max_races: rp?.maxRaces ?? null,
    wins: rp?.wins ?? null,
    elo: rp?.elo ?? null,
    start_min: rp?.startRange?.min ?? null,
    start_max: rp?.startRange?.max ?? null,
    speed_min: rp?.speedRange?.min ?? null,
    speed_max: rp?.speedRange?.max ?? null,
    stamina_min: rp?.staminaRange?.min ?? null,
    stamina_max: rp?.staminaRange?.max ?? null,
    finish_min: rp?.finishRange?.min ?? null,
    finish_max: rp?.finishRange?.max ?? null,
    reveals_start: rp?.revealsPerStat?.start ?? null,
    reveals_speed: rp?.revealsPerStat?.speed ?? null,
    reveals_stamina: rp?.revealsPerStat?.stamina ?? null,
    reveals_finish: rp?.revealsPerStat?.finish ?? null,
    last_synced_at: new Date().toISOString(),
  };
}

// Fetch and upsert one polite batch (<= 25 ids). Returns how many pets the
// API actually knows about; nonexistent ids are silently omitted by the API.
export async function syncPetBatch(ids: number[]): Promise<number> {
  const pets = await fetchPetsBatch(ids);
  if (pets.length === 0) return 0;

  const { error } = await db()
    .from("pets")
    .upsert(pets.map(petRow), { onConflict: "id" });
  if (error) throw new Error(`pets upsert failed: ${error.message}`);

  const traitRows = pets.flatMap((pet) =>
    (pet.racePublic?.traits ?? []).map((trait) => ({
      pet_id: pet.id,
      trait_id: trait.id,
      trait_name: trait.name,
      tier: trait.tier,
    }))
  );
  if (traitRows.length > 0) {
    const { error: traitError } = await db()
      .from("pet_traits")
      .upsert(traitRows, { onConflict: "pet_id,trait_id" });
    if (traitError) throw new Error(`pet_traits upsert failed: ${traitError.message}`);
  }
  return pets.length;
}

export async function syncPetIds(ids: number[]): Promise<number> {
  let synced = 0;
  for (let i = 0; i < ids.length; i += PETS_BATCH_SIZE) {
    synced += await syncPetBatch(ids.slice(i, i + PETS_BATCH_SIZE));
    await sleep(REQUEST_GAP_MS);
  }
  return synced;
}

export interface RollingSyncResult {
  candidates: number;
  synced: number;
}

// Rolling refresh priority:
//   1. pets that appear in recent race entries but are missing or stale in
//      our pets table (their reveals likely just changed)
//   2. a small probe past the highest known id, so new mints are discovered
//   3. the longest-unsynced pets, so full-population coverage keeps rolling
export async function rollingPetSync(options: {
  maxPets: number;
  staleMinutes: number;
}): Promise<RollingSyncResult> {
  const { maxPets, staleMinutes } = options;
  const staleCutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const wanted: number[] = [];
  const seen = new Set<number>();
  const add = (id: number) => {
    if (!seen.has(id) && wanted.length < maxPets) {
      seen.add(id);
      wanted.push(id);
    }
  };

  // 1. recently raced pets that are missing or stale
  const { data: recentEntries, error: entriesError } = await db()
    .from("race_entries")
    .select("pet_id")
    .order("race_id", { ascending: false })
    .limit(2000);
  if (entriesError) throw new Error(`recent entries query failed: ${entriesError.message}`);
  const recentIds = [...new Set((recentEntries ?? []).map((r) => r.pet_id as number))];

  for (let i = 0; i < recentIds.length; i += 500) {
    const chunk = recentIds.slice(i, i + 500);
    const { data: known, error: knownError } = await db()
      .from("pets")
      .select("id, last_synced_at")
      .in("id", chunk);
    if (knownError) throw new Error(`pets staleness query failed: ${knownError.message}`);
    const freshness = new Map((known ?? []).map((p) => [p.id as number, p.last_synced_at as string | null]));
    for (const id of chunk) {
      const syncedAt = freshness.get(id);
      if (syncedAt === undefined || syncedAt === null || syncedAt < staleCutoff) add(id);
    }
  }

  // 2. probe past the frontier for new mints
  const { data: maxRow } = await db()
    .from("pets")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const frontier = (maxRow?.id as number | undefined) ?? 0;
  for (let id = frontier + 1; id <= frontier + PETS_BATCH_SIZE; id++) add(id);

  // 3. fill remaining budget with the longest-unsynced pets
  if (wanted.length < maxPets) {
    const { data: stalest, error: stalestError } = await db()
      .from("pets")
      .select("id")
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(maxPets - wanted.length);
    if (stalestError) throw new Error(`stalest pets query failed: ${stalestError.message}`);
    for (const row of stalest ?? []) add(row.id as number);
  }

  const synced = await syncPetIds(wanted);
  return { candidates: wanted.length, synced };
}
