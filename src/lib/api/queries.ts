import { db } from "../db";
import { FRESH_RANGE_WIDTH } from "../scoring/constants";
import { computeOdds } from "../scoring/odds";
import { computeVerdict, SHARK_WIN_RATE, entrantShrunkWinRate } from "../scoring/verdict";
import { traitMeta, rarityDisplay } from "../display";
import type {
  PetDossier,
  StatRangeDTO,
  WalletSummary,
  PetCardDTO,
  RaceDetail,
  RaceEntrantDTO,
  OddsResponse,
  LeaderboardResponse,
  LeaderboardMetric,
  LeaderboardRow,
  RarityRef,
} from "./types";

const SOURCE = "paddock-db";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function statRange(low: number | null, high: number | null, reveals: number | null): StatRangeDTO {
  const known = low !== null && high !== null;
  const width = known ? Math.max(0, high - low) : FRESH_RANGE_WIDTH;
  const revealPct = clamp01((FRESH_RANGE_WIDTH - width) / FRESH_RANGE_WIDTH);
  return { low, high, reveals, revealPct, revealed: revealPct >= 0.999 };
}

function rarityRef(value: number | null): RarityRef {
  return { value: value ?? 0, name: rarityDisplay(value).name };
}

// ---- ELO ladder threshold (population stat, cached) -------------------------
let eloCache: { value: number; at: number } | null = null;
const ELO_TTL_MS = 5 * 60_000;

const ELO_LADDER_MIN_RACES = 5; // established horses, not 1-race noise

export async function eloThreshold(percentile = 0.9): Promise<number> {
  if (eloCache && Date.now() - eloCache.at < ELO_TTL_MS) return eloCache.value;
  // The percentile of the live ELO ladder, computed without scanning the whole
  // table (Supabase caps result rows): count the ladder, then fetch the single
  // row at the percentile offset, ordered high to low.
  const { count, error: countErr } = await db()
    .from("pets")
    .select("id", { count: "exact", head: true })
    .gte("races_run", ELO_LADDER_MIN_RACES)
    .not("elo", "is", null);
  if (countErr) throw new Error(`elo ladder count failed: ${countErr.message}`);
  const n = count ?? 0;
  if (n < 20) {
    eloCache = { value: 1700, at: Date.now() };
    return 1700;
  }
  const offset = Math.min(n - 1, Math.floor((1 - percentile) * n));
  const { data, error } = await db()
    .from("pets")
    .select("elo")
    .gte("races_run", ELO_LADDER_MIN_RACES)
    .not("elo", "is", null)
    .order("elo", { ascending: false, nullsFirst: false })
    .range(offset, offset);
  if (error) throw new Error(`elo ladder query failed: ${error.message}`);
  const value = data && data[0] ? Number(data[0].elo) : 1700;
  eloCache = { value, at: Date.now() };
  return value;
}

// ---- Pet dossier ------------------------------------------------------------
export async function getPetDossier(id: number): Promise<PetDossier | null> {
  const [{ data: pet, error: petErr }, { data: traits }, { data: score }, { data: history }] = await Promise.all([
    db().from("pets").select("*").eq("id", id).maybeSingle(),
    db().from("pet_traits").select("trait_id, trait_name, tier").eq("pet_id", id),
    db().from("pet_scores").select("*").eq("pet_id", id).maybeSingle(),
    db()
      .from("race_entries")
      .select("race_id, finish_position, payout_wei")
      .eq("pet_id", id)
      .order("race_id", { ascending: false })
      .limit(12),
  ]);
  if (petErr) throw new Error(`pet query failed: ${petErr.message}`);
  if (!pet) return null;

  const historyRaceIds = (history ?? []).map((h) => h.race_id as number);
  const { data: raceMeta } = await db()
    .from("races")
    .select("race_id, field_size, track_length, resolved_at")
    .in("race_id", historyRaceIds.length ? historyRaceIds : [-1]);
  const raceMetaById = new Map((raceMeta ?? []).map((r) => [r.race_id as number, r]));
  const recentRaces = (history ?? []).map((h) => {
    const r = raceMetaById.get(h.race_id as number);
    return {
      raceId: h.race_id as number,
      finishPosition: h.finish_position ?? null,
      fieldSize: r?.field_size ?? null,
      trackLength: r?.track_length ?? null,
      resolvedAt: r?.resolved_at ?? null,
      payoutWei: h.payout_wei != null ? String(h.payout_wei) : null,
    };
  });

  const rawWinRate = pet.races_run ? pet.wins / pet.races_run : null;
  const valComps = (score?.valuation_comps ?? {}) as { thin?: boolean; note?: string; comps?: unknown[] };

  return {
    id: pet.id,
    name: pet.name,
    ownerAddress: pet.owner_address,
    imgUrl: pet.img_url,
    hatched: pet.hatched,
    rarity: rarityRef(pet.rarity),
    faction: { value: pet.faction ?? 0, name: pet.faction_name ?? "None" },
    revealPct: Number(score?.reveal_progress ?? 0),
    stats: {
      start: statRange(pet.start_min, pet.start_max, pet.reveals_start),
      speed: statRange(pet.speed_min, pet.speed_max, pet.reveals_speed),
      stamina: statRange(pet.stamina_min, pet.stamina_max, pet.reveals_stamina),
      finish: statRange(pet.finish_min, pet.finish_max, pet.reveals_finish),
    },
    traits: (traits ?? []).map((t) => {
      const meta = traitMeta(t.trait_id);
      return { id: t.trait_id, name: t.trait_name ?? meta.name, tier: t.tier, blurb: meta.blurb, globalLift: meta.globalLift };
    }),
    scores: {
      confirmedQuality: Number(score?.confirmed_quality ?? 0),
      upside: Number(score?.upside ?? 0),
      bestDistance: Number(score?.best_distance ?? 1200),
      fit: {
        "500": Number(score?.fit_500 ?? 0),
        "1200": Number(score?.fit_1200 ?? 0),
        "2400": Number(score?.fit_2400 ?? 0),
        "3000": Number(score?.fit_3000 ?? 0),
      },
      nextMilestoneIn: score?.next_milestone_in ?? null,
      traitsRevealed: Number(score?.traits_revealed ?? 0),
      traitsTotal: Number(score?.traits_total ?? (traits?.length ?? 0)),
    },
    shark: {
      shrunkWinRate: entrantShrunkWinRate(pet.wins ?? 0, pet.races_run ?? 0),
      rawWinRate,
      wins: pet.wins ?? 0,
      racesRun: pet.races_run ?? 0,
      elo: pet.elo !== null ? Number(pet.elo) : null,
    },
    valuation: {
      lowEth: score?.valuation_low_eth ?? null,
      highEth: score?.valuation_high_eth ?? null,
      compCount: Array.isArray(valComps.comps) ? valComps.comps.length : 0,
      thin: valComps.thin ?? true,
      note: valComps.note ?? "No valuation computed yet.",
    },
    recentRaces,
    meta: { lastSyncedAt: pet.last_synced_at, source: SOURCE },
  };
}

// ---- Wallet summary ---------------------------------------------------------
interface OwnedRow {
  id: number;
  name: string | null;
  img_url: string | null;
  rarity: number | null;
  hatched: boolean;
  elo: number | null;
  confirmed_quality: number | null;
  upside: number | null;
  best_distance: number | null;
  reveal_progress: number | null;
  next_milestone_in: number | null;
  fit_500: number | null;
  fit_1200: number | null;
  fit_2400: number | null;
  fit_3000: number | null;
  valuation_low_eth: number | null;
  valuation_high_eth: number | null;
  valuation_comps: { thin?: boolean; comps?: unknown[] } | null;
}

function toCard(r: OwnedRow): PetCardDTO {
  return {
    id: r.id,
    name: r.name,
    imgUrl: r.img_url,
    rarity: rarityRef(r.rarity),
    confirmedQuality: Number(r.confirmed_quality ?? 0),
    upside: Number(r.upside ?? 0),
    bestDistance: Number(r.best_distance ?? 1200),
    revealPct: Number(r.reveal_progress ?? 0),
    elo: r.elo !== null ? Number(r.elo) : null,
  };
}

export async function getWalletSummary(address: string): Promise<WalletSummary> {
  const owner = address.toLowerCase();
  // Separate queries joined in memory: robust and independent of PostgREST
  // foreign-key metadata, and reads only materialized columns.
  const { data: pets, error } = await db()
    .from("pets")
    .select("id, name, img_url, rarity, hatched, elo, races_run")
    .eq("owner_address", owner)
    .limit(500);
  if (error) throw new Error(`wallet pets query failed: ${error.message}`);

  const ids = (pets ?? []).map((p) => p.id as number);
  const { data: scoreRows, error: scoreErr } = await db()
    .from("pet_scores")
    .select(
      "pet_id, confirmed_quality, upside, best_distance, reveal_progress, next_milestone_in, fit_500, fit_1200, fit_2400, fit_3000, valuation_low_eth, valuation_high_eth, valuation_comps"
    )
    .in("pet_id", ids.length ? ids : [-1]);
  if (scoreErr) throw new Error(`wallet scores query failed: ${scoreErr.message}`);
  const scoreByPet = new Map((scoreRows ?? []).map((s) => [s.pet_id as number, s]));

  const rows: OwnedRow[] = (pets ?? []).map((p) => {
    const s = scoreByPet.get(p.id as number);
    return {
      id: p.id,
      name: p.name,
      img_url: p.img_url,
      rarity: p.rarity,
      hatched: p.hatched,
      elo: p.elo,
      confirmed_quality: s?.confirmed_quality ?? null,
      upside: s?.upside ?? null,
      best_distance: s?.best_distance ?? null,
      reveal_progress: s?.reveal_progress ?? null,
      next_milestone_in: s?.next_milestone_in ?? null,
      fit_500: s?.fit_500 ?? null,
      fit_1200: s?.fit_1200 ?? null,
      fit_2400: s?.fit_2400 ?? null,
      fit_3000: s?.fit_3000 ?? null,
      valuation_low_eth: s?.valuation_low_eth ?? null,
      valuation_high_eth: s?.valuation_high_eth ?? null,
      valuation_comps: (s?.valuation_comps as { thin?: boolean; comps?: unknown[] }) ?? null,
    };
  });

  const hatched = rows.filter((r) => r.hatched);
  const aTeam = [...hatched].sort((a, b) => Number(b.confirmed_quality) - Number(a.confirmed_quality)).slice(0, 5).map(toCard);
  // Hidden gems exclude anything already proven on the A-team, so a horse never
  // appears in both lists (which reads as a glitch).
  const aTeamIds = new Set(aTeam.map((c) => c.id));
  const hiddenGems = [...rows]
    .filter((r) => !aTeamIds.has(r.id))
    .sort((a, b) => Number(b.upside) - Number(a.upside))
    .slice(0, 5)
    .map(toCard);

  const revealQueue = [...rows]
    .filter((r) => r.next_milestone_in !== null)
    .sort((a, b) => {
      const am = (a.next_milestone_in ?? 99) - (b.next_milestone_in ?? 99);
      return am !== 0 ? am : Number(b.upside) - Number(a.upside);
    })
    .slice(0, 6)
    .map((r) => ({ id: r.id, name: r.name, nextMilestoneIn: r.next_milestone_in, upside: Number(r.upside ?? 0), revealPct: Number(r.reveal_progress ?? 0) }));

  const distances: { distance: number; key: keyof OwnedRow }[] = [
    { distance: 500, key: "fit_500" },
    { distance: 1200, key: "fit_1200" },
    { distance: 2400, key: "fit_2400" },
    { distance: 3000, key: "fit_3000" },
  ];
  const trackAssignments = distances.map(({ distance, key }) => {
    let best: OwnedRow | null = null;
    for (const r of hatched) if (!best || Number(r[key]) > Number(best[key])) best = r;
    return { distance, petId: best?.id ?? null, name: best?.name ?? null, fit: best ? Number(best[key]) : 0 };
  });

  let low = 0;
  let high = 0;
  let compCountTotal = 0;
  let anyBand = false;
  for (const r of rows) {
    const comps = r.valuation_comps;
    if (r.valuation_low_eth !== null && r.valuation_high_eth !== null && comps && comps.thin === false) {
      low += Number(r.valuation_low_eth);
      high += Number(r.valuation_high_eth);
      compCountTotal += Array.isArray(comps.comps) ? comps.comps.length : 0;
      anyBand = true;
    }
  }

  const flags: string[] = [];
  if (rows.length > 0 && hatched.length === 0) flags.push("This stable is all potential. Nothing hatched yet.");
  const topConfirmed = await topConfirmedIds(100);
  const ownedTop = rows.filter((r) => topConfirmed.has(r.id)).length;
  if (ownedTop > 0) flags.push(`Owns ${ownedTop} of the top 100 confirmed horses in the game.`);
  const gigaCount = rows.filter((r) => r.rarity === 6).length;
  if (gigaCount > 0) flags.push(`Holds ${gigaCount} Giga${gigaCount === 1 ? "" : "s"}.`);

  return {
    address: owner,
    name: null,
    petCount: rows.length,
    hatchedCount: hatched.length,
    stableValue: {
      lowEth: anyBand ? low : null,
      highEth: anyBand ? high : null,
      estimated: true,
      compCountTotal,
    },
    aTeam,
    hiddenGems,
    revealQueue,
    trackAssignments,
    flags,
    meta: { source: SOURCE, refreshing: false },
  };
}

async function topConfirmedIds(n: number): Promise<Set<number>> {
  const { data } = await db()
    .from("pet_scores")
    .select("pet_id")
    .order("confirmed_quality", { ascending: false, nullsFirst: false })
    .limit(n);
  return new Set((data ?? []).map((r) => r.pet_id as number));
}

// ---- Race detail + verdict --------------------------------------------------
export async function getRaceDetail(id: number, markedPetId?: number): Promise<RaceDetail | null> {
  const { data: race, error } = await db().from("races").select("*").eq("race_id", id).maybeSingle();
  if (error) throw new Error(`race query failed: ${error.message}`);
  if (!race) return null;

  const { data: entries } = await db()
    .from("race_entries")
    .select("pet_id, owner_address, finish_position")
    .eq("race_id", id)
    .order("finish_position", { ascending: true });

  const petIds = (entries ?? []).map((e) => e.pet_id as number);
  const [{ data: pets }, { data: traits }, { data: scores }, threshold] = await Promise.all([
    db().from("pets").select("id, name, owner_address, wins, races_run, elo").in("id", petIds.length ? petIds : [-1]),
    db().from("pet_traits").select("pet_id, trait_id, trait_name, tier").in("pet_id", petIds.length ? petIds : [-1]),
    db().from("pet_scores").select("pet_id, best_distance, reveal_progress").in("pet_id", petIds.length ? petIds : [-1]),
    eloThreshold(),
  ]);

  const petById = new Map((pets ?? []).map((p) => [p.id, p]));
  const scoreById = new Map((scores ?? []).map((s) => [s.pet_id, s]));
  const traitsByPet = new Map<number, { id: string; name: string; tier: number }[]>();
  for (const t of traits ?? []) {
    if (t.tier === null) continue;
    const list = traitsByPet.get(t.pet_id) ?? [];
    list.push({ id: t.trait_id, name: t.trait_name ?? t.trait_id, tier: t.tier });
    traitsByPet.set(t.pet_id, list);
  }

  const entrants: RaceEntrantDTO[] = (entries ?? []).map((e) => {
    const p = petById.get(e.pet_id) ?? ({} as Record<string, unknown>);
    const s = scoreById.get(e.pet_id);
    const wins = Number(p.wins ?? 0);
    const racesRun = Number(p.races_run ?? 0);
    const shrunk = entrantShrunkWinRate(wins, racesRun);
    const elo = p.elo != null ? Number(p.elo) : null;
    return {
      petId: e.pet_id,
      name: (p.name as string) ?? null,
      ownerAddress: (e.owner_address as string) ?? (p.owner_address as string) ?? null,
      finishPosition: e.finish_position ?? null,
      shrunkWinRate: shrunk,
      rawWinRate: racesRun ? wins / racesRun : null,
      wins,
      racesRun,
      elo,
      revealedTraits: traitsByPet.get(e.pet_id) ?? [],
      revealPct: Number(s?.reveal_progress ?? 0),
      bestDistance: Number(s?.best_distance ?? 1200),
      isShark: shrunk >= SHARK_WIN_RATE,
      highElo: elo !== null && elo >= threshold,
    };
  });

  const verdict = computeVerdict(entrants, {
    payoutBps: (race.payout_bps as number[]) ?? null,
    eloThreshold: threshold,
    markedPetId,
    trackLength: race.track_length,
  });

  return {
    raceId: race.race_id,
    trackLength: race.track_length,
    raceTemp: race.race_temp,
    fieldSize: race.field_size,
    entryFeeWei: race.entry_fee_wei != null ? String(race.entry_fee_wei) : null,
    payoutBps: (race.payout_bps as number[]) ?? null,
    feeBps: (race.fee_bps as Record<string, number>) ?? null,
    resolved: race.resolved,
    resolvedAt: race.resolved_at,
    entrants,
    verdict,
    meta: { source: SOURCE, eloThreshold: threshold },
  };
}

// ---- Odds -------------------------------------------------------------------
export async function getOdds(id: number): Promise<OddsResponse | null> {
  const race = await getRaceDetail(id);
  if (!race) return null;
  const trackKey = String(race.trackLength ?? 1200) as "500" | "1200" | "2400" | "3000";
  const inputs = await Promise.all(
    race.entrants.map(async (e) => {
      const { data: s } = await db().from("pet_scores").select("fit_500, fit_1200, fit_2400, fit_3000").eq("pet_id", e.petId).maybeSingle();
      const fit = s ? Number((s as Record<string, number>)[`fit_${trackKey}`] ?? 50) : 50;
      return { petId: e.petId, wins: e.wins, racesRun: e.racesRun, elo: e.elo, trackFit: fit };
    })
  );
  const { modelVersion, results } = computeOdds(inputs);
  const nameById = new Map(race.entrants.map((e) => [e.petId, e.name]));
  return {
    raceId: id,
    modelVersion,
    entrants: results
      .map((r) => ({ petId: r.petId, name: nameById.get(r.petId) ?? null, winProbability: r.winProbability, strength: r.strength }))
      .sort((a, b) => b.winProbability - a.winProbability),
    note: "Win probabilities from shrunk win rate, ELO, and track fit. Model odds-v1 is live but NOT yet calibrated: the self-grading backtest over resolved races is pending and will publish at /calibration. Treat these as uncalibrated estimates until then.",
    meta: { source: SOURCE },
  };
}

// ---- Leaderboard ------------------------------------------------------------
const METRIC_CONFIG: Record<LeaderboardMetric, { column: string; explanation: string; minRaces?: number }> = {
  cq: { column: "confirmed_quality", explanation: "Confirmed quality: how good a horse is, proven from revealed stats, revealed trait tiers weighted by study lifts, and a Bayesian-shrunk win rate." },
  elo: { column: "elo", explanation: "ELO: relative finishing record. Starts at 1500 and moves purely on race results." },
  winrate: { column: "shrunk_winrate", explanation: "Win rate, shrunk toward the 14.18% population baseline so small samples do not top the board. Raw record shown alongside.", minRaces: 5 },
  earnings: { column: "earnings", explanation: "Total ETH won across resolved races." },
};

interface PetBaseRow {
  id: number;
  name: string | null;
  img_url: string | null;
  rarity: number | null;
  elo: number | null;
  wins: number | null;
  races_run: number | null;
}

// Fetch base pet fields for a set of ids, returned as a lookup map.
async function petsByIds(ids: number[]): Promise<Map<number, PetBaseRow>> {
  const { data, error } = await db()
    .from("pets")
    .select("id, name, img_url, rarity, elo, wins, races_run")
    .in("id", ids.length ? ids : [-1]);
  if (error) throw new Error(`pets lookup failed: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.id as number, p as PetBaseRow]));
}

function leaderboardRow(rank: number, p: PetBaseRow | undefined, petId: number, value: number, cq: number, earningsEth: number | null): LeaderboardRow {
  const racesRun = Number(p?.races_run ?? 0);
  const wins = Number(p?.wins ?? 0);
  return {
    rank,
    petId,
    name: p?.name ?? null,
    imgUrl: p?.img_url ?? null,
    rarity: rarityRef(p?.rarity ?? 0),
    value,
    confirmedQuality: cq,
    elo: p?.elo != null ? Number(p.elo) : null,
    shrunkWinRate: entrantShrunkWinRate(wins, racesRun),
    rawWinRate: racesRun ? wins / racesRun : null,
    racesRun,
    earningsEth,
  };
}

export async function getLeaderboard(
  metric: LeaderboardMetric,
  limit: number,
  offset: number
): Promise<LeaderboardResponse> {
  const cfg = METRIC_CONFIG[metric];

  if (metric === "cq") {
    const { data, count } = await db()
      .from("pet_scores")
      .select("pet_id, confirmed_quality", { count: "exact" })
      .order("confirmed_quality", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    const ids = (data ?? []).map((r) => r.pet_id as number);
    const pets = await petsByIds(ids);
    return {
      metric,
      limit,
      offset,
      total: count ?? 0,
      rows: (data ?? []).map((r, i) => {
        const cq = Number(r.confirmed_quality ?? 0);
        return leaderboardRow(offset + i + 1, pets.get(r.pet_id as number), r.pet_id as number, cq, cq, null);
      }),
      meta: { source: SOURCE, explanation: cfg.explanation },
    };
  }

  if (metric === "elo") {
    const { data, count } = await db()
      .from("pets")
      .select("id, name, img_url, rarity, elo, wins, races_run", { count: "exact" })
      .gt("races_run", 0)
      .order("elo", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    const ids = (data ?? []).map((p) => p.id as number);
    const scores = await scoresByIds(ids);
    return {
      metric,
      limit,
      offset,
      total: count ?? 0,
      rows: (data ?? []).map((p, i) =>
        leaderboardRow(offset + i + 1, p as PetBaseRow, p.id as number, p.elo != null ? Number(p.elo) : 0, scores.get(p.id as number) ?? 0, null)
      ),
      meta: { source: SOURCE, explanation: cfg.explanation },
    };
  }

  if (metric === "winrate") {
    // Min-races threshold keeps the board meaningful; rank by shrunk rate over a
    // bounded high-win candidate set, then paginate.
    const { data } = await db()
      .from("pets")
      .select("id, name, img_url, rarity, elo, wins, races_run")
      .gte("races_run", cfg.minRaces ?? 5)
      .order("wins", { ascending: false })
      .limit(800);
    const ranked = (data ?? [])
      .map((p) => ({ p: p as PetBaseRow, shrunk: entrantShrunkWinRate(Number(p.wins ?? 0), Number(p.races_run ?? 0)) }))
      .sort((a, b) => b.shrunk - a.shrunk);
    const page = ranked.slice(offset, offset + limit);
    const scores = await scoresByIds(page.map((x) => x.p.id));
    return {
      metric,
      limit,
      offset,
      total: ranked.length,
      rows: page.map((x, i) =>
        leaderboardRow(offset + i + 1, x.p, x.p.id, x.shrunk, scores.get(x.p.id) ?? 0, null)
      ),
      meta: { source: SOURCE, explanation: cfg.explanation },
    };
  }

  return earningsLeaderboardFallback(limit, offset, cfg.explanation);
}

async function scoresByIds(ids: number[]): Promise<Map<number, number>> {
  const { data } = await db()
    .from("pet_scores")
    .select("pet_id, confirmed_quality")
    .in("pet_id", ids.length ? ids : [-1]);
  return new Map((data ?? []).map((s) => [s.pet_id as number, Number(s.confirmed_quality ?? 0)]));
}

// Earnings has no materialized column, so it is aggregated from race_entries.
// To honor the no-compute-on-request rule, the full ranked aggregate is cached
// server-side with a TTL; only a cache miss scans (paginated, ~2-3 pages). This
// TTL is the documented earnings exception in the API docs.
let earningsCache: { ranked: [number, number][]; at: number } | null = null;
const EARNINGS_TTL_MS = 5 * 60_000;

async function earningsRanked(): Promise<[number, number][]> {
  if (earningsCache && Date.now() - earningsCache.at < EARNINGS_TTL_MS) return earningsCache.ranked;
  const totals = new Map<number, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("race_entries")
      .select("pet_id, payout_wei")
      .not("payout_wei", "is", null)
      .gt("payout_wei", 0)
      .order("race_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`earnings scan failed: ${error.message}`);
    for (const r of data ?? []) {
      const wei = Number(r.payout_wei);
      if (!Number.isFinite(wei) || wei <= 0) continue;
      totals.set(r.pet_id as number, (totals.get(r.pet_id as number) ?? 0) + wei);
    }
    if (!data || data.length < PAGE) break;
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  earningsCache = { ranked, at: Date.now() };
  return ranked;
}

async function earningsLeaderboardFallback(limit: number, offset: number, explanation: string): Promise<LeaderboardResponse> {
  const ranked = await earningsRanked();
  const total = ranked.length;
  const pageIds = ranked.slice(offset, offset + limit);
  const ids = pageIds.map(([id]) => id);
  const [pets, scores] = await Promise.all([petsByIds(ids), scoresByIds(ids)]);
  return {
    metric: "earnings",
    limit,
    offset,
    total,
    rows: pageIds.map(([id, wei], i) =>
      leaderboardRow(offset + i + 1, pets.get(id), id, wei / 1e18, scores.get(id) ?? 0, wei / 1e18)
    ),
    meta: { source: SOURCE, explanation },
  };
}

// ---- Site stats (home headline) ---------------------------------------------
import type { SiteStats } from "./types";

export async function getSiteStats(): Promise<SiteStats> {
  const count = async (table: string, filter?: [string, unknown]) => {
    let q = db().from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count: n } = await q;
    return n ?? 0;
  };
  const [racesResolved, racesCreated, totalPets, hatchedPets, sale, top, price, freshPet, raceScan] = await Promise.all([
    count("races", ["resolved", true]),
    count("races"),
    count("pets"),
    count("pets", ["hatched", true]),
    db().from("sales").select("token_id, price_eth, sold_at").not("price_eth", "is", null).order("price_eth", { ascending: false }).limit(1).maybeSingle(),
    db().from("pet_scores").select("pet_id, confirmed_quality").order("confirmed_quality", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db().from("eth_price").select("usd").eq("id", 1).maybeSingle(),
    db().from("pets").select("last_synced_at").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db().from("sync_state").select("updated_at").eq("key", "races_scan").maybeSingle(),
  ]);

  let topName: string | null = null;
  if (top.data) {
    const { data: p } = await db().from("pets").select("name").eq("id", top.data.pet_id).maybeSingle();
    topName = p?.name ?? null;
  }

  return {
    racesResolved,
    racesCreated,
    totalPets,
    hatchedPets,
    recentBigSale: sale.data ? { tokenId: sale.data.token_id as number, priceEth: Number(sale.data.price_eth), soldAt: sale.data.sold_at as string } : null,
    topConfirmed: top.data ? { petId: top.data.pet_id as number, name: topName, confirmedQuality: Number(top.data.confirmed_quality) } : null,
    ethUsd: price.data ? Number(price.data.usd) : null,
    petsSyncedAt: (freshPet.data?.last_synced_at as string) ?? null,
    racesScannedAt: (raceScan.data?.updated_at as string) ?? null,
    meta: { source: SOURCE },
  };
}

// ---- Races feed -------------------------------------------------------------
import type { RaceListResponse, RaceListItem } from "./types";

export async function getRecentRaces(track: number | null, limit: number, offset: number): Promise<RaceListResponse> {
  let q = db()
    .from("races")
    .select("race_id, track_length, field_size, race_temp, resolved_at, payout_bps")
    .eq("resolved", true)
    .eq("hydrated", true)
    .order("resolved_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (track) q = q.eq("track_length", track);
  const { data, error } = await q;
  if (error) throw new Error(`races feed query failed: ${error.message}`);

  const raceIds = (data ?? []).map((r) => r.race_id as number);
  // Winner = finish_position 1 for each race, fetched in one query then mapped.
  const { data: winners } = await db()
    .from("race_entries")
    .select("race_id, pet_id")
    .in("race_id", raceIds.length ? raceIds : [-1])
    .eq("finish_position", 1);
  const winnerByRace = new Map((winners ?? []).map((w) => [w.race_id as number, w.pet_id as number]));
  const winnerIds = [...new Set([...winnerByRace.values()])];
  const { data: petNames } = await db().from("pets").select("id, name").in("id", winnerIds.length ? winnerIds : [-1]);
  const nameById = new Map((petNames ?? []).map((p) => [p.id as number, p.name as string | null]));

  const races: RaceListItem[] = (data ?? []).map((r) => {
    const winnerPetId = winnerByRace.get(r.race_id as number) ?? null;
    return {
      raceId: r.race_id as number,
      trackLength: r.track_length,
      fieldSize: r.field_size,
      raceTemp: r.race_temp,
      resolvedAt: r.resolved_at,
      payoutBps: (r.payout_bps as number[]) ?? null,
      winnerPetId,
      winnerName: winnerPetId != null ? nameById.get(winnerPetId) ?? null : null,
    };
  });

  return { races, limit, offset, track, meta: { source: SOURCE } };
}

// ---- Live-lobby scan (arbitrary pet ids, not a stored race) -----------------
export async function getScan(petIds: number[], trackLength: number, markedPetId?: number): Promise<RaceDetail> {
  const ids = petIds.length ? petIds : [-1];
  const [{ data: pets }, { data: traits }, { data: scores }, threshold] = await Promise.all([
    db().from("pets").select("id, name, owner_address, wins, races_run, elo").in("id", ids),
    db().from("pet_traits").select("pet_id, trait_id, trait_name, tier").in("pet_id", ids),
    db().from("pet_scores").select("pet_id, best_distance, reveal_progress").in("pet_id", ids),
    eloThreshold(),
  ]);
  const petById = new Map((pets ?? []).map((p) => [p.id, p]));
  const scoreById = new Map((scores ?? []).map((s) => [s.pet_id, s]));
  const traitsByPet = new Map<number, { id: string; name: string; tier: number }[]>();
  for (const t of traits ?? []) {
    if (t.tier === null) continue;
    const list = traitsByPet.get(t.pet_id) ?? [];
    list.push({ id: t.trait_id, name: t.trait_name ?? t.trait_id, tier: t.tier });
    traitsByPet.set(t.pet_id, list);
  }

  // Preserve the caller's pet order; unknown ids are surfaced as empty entrants.
  const entrants: RaceEntrantDTO[] = petIds.map((id) => {
    const p = (petById.get(id) ?? {}) as Record<string, unknown>;
    const s = scoreById.get(id);
    const wins = Number(p.wins ?? 0);
    const racesRun = Number(p.races_run ?? 0);
    const shrunk = entrantShrunkWinRate(wins, racesRun);
    const elo = p.elo != null ? Number(p.elo) : null;
    return {
      petId: id,
      name: (p.name as string) ?? null,
      ownerAddress: (p.owner_address as string) ?? null,
      finishPosition: null,
      shrunkWinRate: shrunk,
      rawWinRate: racesRun ? wins / racesRun : null,
      wins,
      racesRun,
      elo,
      revealedTraits: traitsByPet.get(id) ?? [],
      revealPct: Number(s?.reveal_progress ?? 0),
      bestDistance: Number(s?.best_distance ?? 1200),
      isShark: shrunk >= SHARK_WIN_RATE,
      highElo: elo !== null && elo >= threshold,
    };
  });

  // A live lobby has no announced payout, so the payout-trap signal is not
  // assessable; the verdict leans on sharks, in-form horses, and your fit.
  const verdict = computeVerdict(entrants, { payoutBps: null, eloThreshold: threshold, markedPetId, trackLength });

  return {
    raceId: 0,
    trackLength,
    raceTemp: null,
    fieldSize: entrants.length,
    entryFeeWei: null,
    payoutBps: null,
    feeBps: null,
    resolved: false,
    resolvedAt: null,
    entrants,
    verdict,
    meta: { source: SOURCE, eloThreshold: threshold },
  };
}
