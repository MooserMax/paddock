import { db } from "../db";
import { PetInput, StatKey, scorePet } from "../scoring/engine";
import { SoldPet, valuationBand } from "../scoring/valuation";

interface PetRow {
  id: number;
  rarity: number | null;
  races_run: number | null;
  max_races: number | null;
  wins: number | null;
  start_min: number | null;
  start_max: number | null;
  speed_min: number | null;
  speed_max: number | null;
  stamina_min: number | null;
  stamina_max: number | null;
  finish_min: number | null;
  finish_max: number | null;
  reveals_start: number | null;
  reveals_speed: number | null;
  reveals_stamina: number | null;
  reveals_finish: number | null;
}

interface TraitRow {
  pet_id: number;
  trait_id: string;
  tier: number | null;
}

function toPetInput(row: PetRow, traits: TraitRow[]): PetInput {
  const stat = (
    min: number | null,
    max: number | null,
    reveals: number | null
  ) => ({ min, max, reveals });
  const stats: Record<StatKey, { min: number | null; max: number | null; reveals: number | null }> = {
    start: stat(row.start_min, row.start_max, row.reveals_start),
    speed: stat(row.speed_min, row.speed_max, row.reveals_speed),
    stamina: stat(row.stamina_min, row.stamina_max, row.reveals_stamina),
    finish: stat(row.finish_min, row.finish_max, row.reveals_finish),
  };
  return {
    rarity: row.rarity,
    racesRun: row.races_run,
    maxRaces: row.max_races,
    wins: row.wins,
    stats,
    traits: traits.map((t) => ({ id: t.trait_id, tier: t.tier })),
  };
}

async function loadAllPets(): Promise<PetRow[]> {
  const out: PetRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from("pets")
      .select(
        "id, rarity, races_run, max_races, wins, start_min, start_max, speed_min, speed_max, stamina_min, stamina_max, finish_min, finish_max, reveals_start, reveals_speed, reveals_stamina, reveals_finish"
      )
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`pets load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as PetRow[]));
    if (data.length < pageSize) break;
  }
  return out;
}

async function loadAllTraits(): Promise<Map<number, TraitRow[]>> {
  const map = new Map<number, TraitRow[]>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from("pet_traits")
      .select("pet_id, trait_id, tier")
      .order("pet_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`traits load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as TraitRow[]) {
      const list = map.get(row.pet_id) ?? [];
      list.push(row);
      map.set(row.pet_id, list);
    }
    if (data.length < pageSize) break;
  }
  return map;
}

async function loadSales(): Promise<Map<number, { priceEth: number; soldAt: string }[]>> {
  const map = new Map<number, { priceEth: number; soldAt: string }[]>();
  // Paginate: Supabase caps each response at 1000 rows. With the comp pool
  // capped, valuation bands would silently narrow as the sales table grows.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("sales")
      .select("token_id, price_eth, sold_at")
      .not("price_eth", "is", null)
      .order("sold_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sales load failed: ${error.message}`);
    for (const row of data ?? []) {
      const list = map.get(row.token_id as number) ?? [];
      list.push({ priceEth: Number(row.price_eth), soldAt: row.sold_at as string });
      map.set(row.token_id as number, list);
    }
    if (!data || data.length < PAGE) break;
  }
  return map;
}

export interface MaterializeResult {
  scored: number;
  valued: number;
}

// Recompute pet_scores for the whole population so reads are instant. Scores
// first (pure), then valuation bands using sold pets as comps.
export async function materializeScores(): Promise<MaterializeResult> {
  const [pets, traitMap, salesMap] = await Promise.all([
    loadAllPets(),
    loadAllTraits(),
    loadSales(),
  ]);

  const scored = pets.map((row) => {
    const input = toPetInput(row, traitMap.get(row.id) ?? []);
    return { row, input, score: scorePet(input) };
  });
  const scoreById = new Map(scored.map((s) => [s.row.id, s]));

  // Build the comp pool: every sale attached to a currently-scored pet.
  const soldPets: SoldPet[] = [];
  for (const [tokenId, sales] of salesMap) {
    const s = scoreById.get(tokenId);
    if (!s) continue;
    for (const sale of sales) {
      soldPets.push({
        tokenId,
        rarity: s.row.rarity,
        confirmedQuality: s.score.confirmedQuality,
        revealProgress: s.score.revealProgress,
        priceEth: sale.priceEth,
        soldAt: sale.soldAt,
      });
    }
  }

  let valued = 0;
  const rows = scored.map(({ row, score }) => {
    const band = valuationBand(
      {
        rarity: row.rarity,
        confirmedQuality: score.confirmedQuality,
        revealProgress: score.revealProgress,
      },
      soldPets
    );
    if (!band.thin) valued += 1;
    return {
      pet_id: row.id,
      reveal_progress: round(score.revealProgress, 4),
      traits_revealed: score.traitsRevealed,
      traits_total: score.traitsTotal,
      confirmed_quality: round(score.confirmedQuality, 3),
      upside: round(score.upside, 3),
      fit_500: round(score.fit[500], 2),
      fit_1200: round(score.fit[1200], 2),
      fit_2400: round(score.fit[2400], 2),
      fit_3000: round(score.fit[3000], 2),
      best_distance: score.bestDistance,
      next_milestone_in: score.nextMilestoneIn,
      valuation_low_eth: band.low,
      valuation_high_eth: band.high,
      valuation_comps: { thin: band.thin, note: band.note, comps: band.comps },
      updated_at: new Date().toISOString(),
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db()
      .from("pet_scores")
      .upsert(rows.slice(i, i + 500), { onConflict: "pet_id" });
    if (error) throw new Error(`pet_scores upsert failed: ${error.message}`);
  }

  return { scored: rows.length, valued };
}

function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
