import { db } from "../db";
import { lookupUsername, lookupUsernames } from "../accounts";
import { FRESH_RANGE_WIDTH } from "../scoring/constants";
import { computeOdds } from "../scoring/odds";
import { pWinBand, PWIN_CEILING } from "../format";
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
  const valComps = (score?.valuation_comps ?? {}) as { thin?: boolean; note?: string; comps?: { tokenId: number; priceEth: number; soldAt: string }[] };
  const ownerName = await lookupUsername(pet.owner_address);
  const recWrap = await recordsBlob();
  const records = recWrap ? petRecordsFromBlob(recWrap.blob, id) : [];

  // Recent comparable sales: the per-pet valuation comps are already real,
  // rarity-matched, and newest-first, so the most recent 3 come straight from them.
  // If there are no rarity-matched comps, widen to recent collection sales and label
  // it; never mix the two, never fabricate a price.
  const matchedComps = Array.isArray(valComps.comps) ? valComps.comps : [];
  let recentSales = matchedComps.slice(0, 3).map((c) => ({ tokenId: c.tokenId, priceEth: c.priceEth, soldAt: c.soldAt }));
  let recentSalesWidened = false;
  if (recentSales.length === 0) {
    const { data: coll } = await db().from("sales").select("token_id, price_eth, sold_at").not("price_eth", "is", null).order("sold_at", { ascending: false }).limit(3);
    recentSales = (coll ?? []).map((s) => ({ tokenId: s.token_id as number, priceEth: Number(s.price_eth), soldAt: s.sold_at as string }));
    recentSalesWidened = recentSales.length > 0;
  }

  return {
    id: pet.id,
    name: pet.name,
    ownerAddress: pet.owner_address,
    ownerName,
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
      lowConfidence: !(valComps.thin ?? true) && (Array.isArray(valComps.comps) ? valComps.comps.length : 0) < 5,
      note: valComps.note ?? "No valuation computed yet.",
    },
    recentSales,
    recentSalesWidened,
    recentRaces,
    records,
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
  // The FULL stable, paginated to completion. A wallet's pets must never cap at a
  // page boundary: petCount, the hatched/total split, stable value, the top-100
  // flag, the A-team, hidden gems, and the reveal queue are all computed from this
  // set, so a truncated subset would be a fabricated count.
  type WalletPetRow = { id: number; name: string | null; img_url: string | null; rarity: number | null; hatched: boolean; elo: number | null; races_run: number | null };
  const pets: WalletPetRow[] = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("pets")
        .select("id, name, img_url, rarity, hatched, elo, races_run")
        .eq("owner_address", owner)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`wallet pets query failed: ${error.message}`);
      if (!data || data.length === 0) break;
      pets.push(...(data as WalletPetRow[]));
      if (data.length < PAGE) break;
    }
  }

  const ids = pets.map((p) => p.id);
  // Scores joined in <=1000-id chunks so this side never caps at the row ceiling either.
  type WalletScoreRow = {
    pet_id: number; confirmed_quality: number | null; upside: number | null; best_distance: number | null;
    reveal_progress: number | null; next_milestone_in: number | null; fit_500: number | null; fit_1200: number | null;
    fit_2400: number | null; fit_3000: number | null; valuation_low_eth: number | null; valuation_high_eth: number | null;
    valuation_comps: { thin?: boolean; comps?: unknown[] } | null;
  };
  const scoreByPet = new Map<number, WalletScoreRow>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data, error: scoreErr } = await db()
      .from("pet_scores")
      .select(
        "pet_id, confirmed_quality, upside, best_distance, reveal_progress, next_milestone_in, fit_500, fit_1200, fit_2400, fit_3000, valuation_low_eth, valuation_high_eth, valuation_comps"
      )
      .in("pet_id", ids.slice(i, i + 1000));
    if (scoreErr) throw new Error(`wallet scores query failed: ${scoreErr.message}`);
    for (const s of data ?? []) scoreByPet.set(s.pet_id as number, s as WalletScoreRow);
  }

  const rows: OwnedRow[] = pets.map((p) => {
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

  // Combine per-horse comp bands into a stable band. The midpoint is the sum of
  // per-horse midpoints. The band combines per-horse half-widths in QUADRATURE
  // with a correlation factor, NOT linearly: summing lows-to-lows and highs-to-
  // highs falsely assumes every horse lands at its 25th (or 75th) percentile at
  // once, which has near-zero probability and massively overstates the band.
  // rho is the average pairwise correlation of horse values, the share that moves
  // together with ETH and collection demand. Measured at 0.016 over the available
  // (short, near-flat) sales window, which understates realization-horizon co-
  // movement; we adopt 0.15, within the 15 to 30 percent single-factor share
  // typical of NFT-collection assets, retaining a real systematic component while
  // correcting the linear overstatement. See scripts/measure-value-correlation.mts.
  const VALUE_RHO = 0.15;
  const VALUE_SANITY_FLOOR = 0.02; // never tighter than +-2% of the midpoint
  let mid = 0;
  let sumHalf = 0; // linear sum of half-widths
  let sumHalfSq = 0; // sum of squared half-widths
  let compCountTotal = 0;
  let anyBand = false;
  for (const r of rows) {
    const comps = r.valuation_comps;
    if (r.valuation_low_eth !== null && r.valuation_high_eth !== null && comps && comps.thin === false) {
      const lo = Number(r.valuation_low_eth);
      const hi = Number(r.valuation_high_eth);
      mid += (lo + hi) / 2;
      const half = (hi - lo) / 2;
      sumHalf += half;
      sumHalfSq += half * half;
      compCountTotal += Array.isArray(comps.comps) ? comps.comps.length : 0;
      anyBand = true;
    }
  }
  const combinedHalf = Math.max(
    VALUE_SANITY_FLOOR * mid,
    Math.sqrt((1 - VALUE_RHO) * sumHalfSq + VALUE_RHO * sumHalf * sumHalf)
  );
  const low = mid - combinedHalf;
  const high = mid + combinedHalf;

  const flags: string[] = [];
  if (rows.length > 0 && hatched.length === 0) flags.push("This stable is all potential. Nothing hatched yet.");
  const topConfirmed = await topConfirmedIds(100);
  const ownedTop = rows.filter((r) => topConfirmed.has(r.id)).length;
  if (ownedTop > 0) flags.push(`Owns ${ownedTop} of the top 100 confirmed horses in the game.`);
  const gigaCount = rows.filter((r) => r.rarity === 6).length;
  if (gigaCount > 0) flags.push(`Holds ${gigaCount} Giga${gigaCount === 1 ? "" : "s"}.`);

  const skill = await getStableSkill(owner);
  // A natural, on-brand flag for high rankers, in the existing flags style. Rank-
  // based so it matches the displayed bracket (rank 2 of 197 shows "top 1.0%").
  if (skill.state === "ranked" && skill.rank != null && skill.rank <= Math.ceil(skill.eligibleTotal * 0.01)) {
    flags.unshift("Top 1% of stables by proven roster quality.");
  }

  return {
    address: owner,
    name: await lookupUsername(owner),
    petCount: rows.length,
    hatchedCount: hatched.length,
    stableValue: {
      lowEth: anyBand ? low : null,
      highEth: anyBand ? high : null,
      estimated: true,
      compCountTotal,
    },
    skill,
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

// Build the marked horse's fit map (keys 500/1200/2400/3000) for the verdict's
// distance-fit assessment. Returns undefined if any fit column is missing, so the
// verdict simply emits no fit badge rather than acting on partial data.
function markedFitMap(score: Record<string, unknown> | undefined): Record<number, number> | undefined {
  if (!score) return undefined;
  const cols: [number, string][] = [[500, "fit_500"], [1200, "fit_1200"], [2400, "fit_2400"], [3000, "fit_3000"]];
  const m: Record<number, number> = {};
  for (const [track, col] of cols) {
    const v = score[col];
    if (v == null || !Number.isFinite(Number(v))) return undefined;
    m[track] = Number(v);
  }
  return m;
}

// ---- Race detail + verdict --------------------------------------------------
export async function getRaceDetail(id: number, markedPetId?: number): Promise<RaceDetail | null> {
  const { data: race, error } = await db().from("races").select("*").eq("race_id", id).maybeSingle();
  if (error) throw new Error(`race query failed: ${error.message}`);
  if (!race) return null;

  const { data: entries } = await db()
    .from("race_entries")
    .select("pet_id, owner_address, finish_position, finish_time_ms")
    .eq("race_id", id)
    .order("finish_position", { ascending: true });

  const petIds = (entries ?? []).map((e) => e.pet_id as number);
  const [{ data: pets }, { data: traits }, { data: scores }, threshold] = await Promise.all([
    db().from("pets").select("id, name, owner_address, wins, races_run, elo").in("id", petIds.length ? petIds : [-1]),
    db().from("pet_traits").select("pet_id, trait_id, trait_name, tier").in("pet_id", petIds.length ? petIds : [-1]),
    db().from("pet_scores").select("pet_id, best_distance, reveal_progress, fit_500, fit_1200, fit_2400, fit_3000").in("pet_id", petIds.length ? petIds : [-1]),
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

  const recWrap = await recordsBlob();
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
      timeMs: e.finish_time_ms != null ? Number(e.finish_time_ms) : null,
      recordNote: recWrap ? recordNoteFromBlob(recWrap.blob, e.pet_id) : null,
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
    markedFit: markedPetId != null ? markedFitMap(scoreById.get(markedPetId) as Record<string, unknown> | undefined) : undefined,
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
    note: "Win probabilities from shrunk win rate, ELO, and track fit. The win-rate core is calibrated out of sample at /calibration (well-calibrated below 50%, overconfident above); the ELO and track-fit components are current-only and remain uncalibrated. Treat high-confidence probabilities with caution.",
    meta: { source: SOURCE },
  };
}

// ---- Leaderboard ------------------------------------------------------------
const METRIC_CONFIG: Record<LeaderboardMetric, { column: string; explanation: string; minRaces?: number }> = {
  cq: { column: "confirmed_quality", explanation: "Confirmed quality: how good a horse is, proven from revealed stats, revealed trait tiers weighted by study lifts, and a Bayesian-shrunk win rate." },
  elo: { column: "elo", explanation: "ELO: relative finishing record. Starts at 1500 and moves purely on race results." },
  winrate: { column: "shrunk_winrate", explanation: "Win rate, shrunk toward the 14.18% population baseline so small samples do not top the board. Raw record shown alongside.", minRaces: 5 },
  earnings: { column: "earnings", explanation: "Total ETH won across resolved races." },
  upside: { column: "upside", explanation: "Lightly revealed horses whose upside runs ahead of how little they have shown. Potential adjusted for reveal level (upside above the typical for that reveal level), not a prediction, and never raw upside (which just favors the least revealed). Reveal 2 to 60 percent." },
};

// Reveal-adjusted upside ranking. Raw upside decays mechanically with reveal
// (less revealed means more unrealized headroom), so a naive sort by upside ranks
// the least-revealed horses on top, which is ranking by ignorance. Instead: build
// a baseline of typical upside per reveal level from the real (revealed) population,
// then rank by each horse's upside ABOVE that baseline, surfacing horses punching
// above their reveal level rather than horses that merely reveal less. The band
// excludes 0-reveal constant-upside zombies (floor) and heavily-revealed horses
// that belong on the CQ board (ceiling). Cached like earnings; the heavy full-table
// pass runs at most once per TTL.
const UPSIDE_FLOOR = 0.02; // revealPct >= this: excludes the 25k zero-reveal zombies (upside 24.000 etc.)
const UPSIDE_CEIL = 0.6; // revealPct < this: heavily-revealed horses belong on CQ
const UPSIDE_BIN = 0.05; // baseline bin width over revealPct
const UPSIDE_TTL_MS = 5 * 60_000;
let upsideCache: { ranked: { petId: number; dev: number; revealPct: number; upside: number }[]; at: number } | null = null;

async function upsideRanked(): Promise<{ petId: number; dev: number; revealPct: number; upside: number }[]> {
  if (upsideCache && Date.now() - upsideCache.at < UPSIDE_TTL_MS) return upsideCache.ranked;
  const rows: { id: number; r: number; u: number }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from("pet_scores").select("pet_id, reveal_progress, upside").order("pet_id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`upside scan failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const d of data) if (d.upside != null) rows.push({ id: d.pet_id as number, r: Number(d.reveal_progress ?? 0), u: Number(d.upside) });
    if (data.length < PAGE) break;
  }
  // Baseline: binned mean upside over horses with ANY reveal (zombies excluded),
  // so the "typical at this reveal level" is set by real horses, not the 0-reveal mass.
  const bm = new Map<number, { n: number; s: number }>();
  for (const x of rows) {
    if (x.r <= 0.001) continue;
    const b = Math.floor(x.r / UPSIDE_BIN);
    const e = bm.get(b) ?? { n: 0, s: 0 };
    e.n += 1;
    e.s += x.u;
    bm.set(b, e);
  }
  const baseline = (r: number): number | null => {
    const e = bm.get(Math.floor(r / UPSIDE_BIN));
    return e ? e.s / e.n : null;
  };
  const ranked = rows
    .filter((x) => x.r >= UPSIDE_FLOOR && x.r < UPSIDE_CEIL)
    .map((x) => {
      const b = baseline(x.r);
      return b == null ? null : { petId: x.id, dev: x.u - b, revealPct: x.r, upside: x.u };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.dev - a.dev);
  upsideCache = { ranked, at: Date.now() };
  return ranked;
}

interface PetBaseRow {
  id: number;
  name: string | null;
  img_url: string | null;
  owner_address: string | null;
  rarity: number | null;
  elo: number | null;
  wins: number | null;
  races_run: number | null;
}

const PET_BASE_COLS = "id, name, img_url, owner_address, rarity, elo, wins, races_run";

// Fetch base pet fields for a set of ids, returned as a lookup map.
async function petsByIds(ids: number[]): Promise<Map<number, PetBaseRow>> {
  const { data, error } = await db()
    .from("pets")
    .select(PET_BASE_COLS)
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
    ownerAddress: p?.owner_address ?? null,
    ownerName: null, // filled by withOwnerNames() in one batched lookup
    rarity: rarityRef(p?.rarity ?? 0),
    value,
    confirmedQuality: cq,
    elo: p?.elo != null ? Number(p.elo) : null,
    shrunkWinRate: entrantShrunkWinRate(wins, racesRun),
    rawWinRate: racesRun ? wins / racesRun : null,
    racesRun,
    earningsEth,
    revealPct: null, // set per-row only on the upside board
    upsideRaw: null,
  };
}

// Resolve owner usernames for a page of rows in a single batched query, so a
// 50-row board is one accounts lookup, not fifty.
async function withOwnerNames(rows: LeaderboardRow[]): Promise<LeaderboardRow[]> {
  const names = await lookupUsernames(rows.map((r) => r.ownerAddress));
  for (const r of rows) {
    r.ownerName = r.ownerAddress ? names.get(r.ownerAddress.toLowerCase()) ?? null : null;
  }
  return rows;
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
      rows: await withOwnerNames(
        (data ?? []).map((r, i) => {
          const cq = Number(r.confirmed_quality ?? 0);
          return leaderboardRow(offset + i + 1, pets.get(r.pet_id as number), r.pet_id as number, cq, cq, null);
        })
      ),
      meta: { source: SOURCE, explanation: cfg.explanation },
    };
  }

  if (metric === "elo") {
    const { data, count } = await db()
      .from("pets")
      .select(PET_BASE_COLS, { count: "exact" })
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
      rows: await withOwnerNames(
        (data ?? []).map((p, i) =>
          leaderboardRow(offset + i + 1, p as PetBaseRow, p.id as number, p.elo != null ? Number(p.elo) : 0, scores.get(p.id as number) ?? 0, null)
        )
      ),
      meta: { source: SOURCE, explanation: cfg.explanation },
    };
  }

  if (metric === "winrate") {
    // Rank shrunk win rate over the FULL eligible population (>= minRaces),
    // paginated to completion. A top-by-raw-wins candidate cap would silently drop
    // high-rate, moderate-win horses (e.g. 6 of 10) from the board entirely.
    const eligible: PetBaseRow[] = [];
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db()
          .from("pets")
          .select(PET_BASE_COLS)
          .gte("races_run", cfg.minRaces ?? 5)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`winrate eligible query failed: ${error.message}`);
        if (!data || data.length === 0) break;
        eligible.push(...(data as PetBaseRow[]));
        if (data.length < PAGE) break;
      }
    }
    const ranked = eligible
      .map((p) => ({ p, shrunk: entrantShrunkWinRate(Number(p.wins ?? 0), Number(p.races_run ?? 0)) }))
      .sort((a, b) => b.shrunk - a.shrunk);
    const page = ranked.slice(offset, offset + limit);
    const scores = await scoresByIds(page.map((x) => x.p.id));
    return {
      metric,
      limit,
      offset,
      total: ranked.length,
      rows: await withOwnerNames(
        page.map((x, i) => leaderboardRow(offset + i + 1, x.p, x.p.id, x.shrunk, scores.get(x.p.id) ?? 0, null))
      ),
      meta: { source: SOURCE, explanation: cfg.explanation },
    };
  }

  if (metric === "upside") {
    const ranked = await upsideRanked();
    const page = ranked.slice(offset, offset + limit);
    const ids = page.map((x) => x.petId);
    const [pets, scores] = await Promise.all([petsByIds(ids), scoresByIds(ids)]);
    return {
      metric,
      limit,
      offset,
      total: ranked.length,
      rows: await withOwnerNames(
        page.map((x, i) => {
          const row = leaderboardRow(offset + i + 1, pets.get(x.petId), x.petId, x.dev, scores.get(x.petId) ?? 0, null);
          row.revealPct = x.revealPct;
          row.upsideRaw = x.upside;
          return row;
        })
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
    rows: await withOwnerNames(
      pageIds.map(([id, wei], i) => leaderboardRow(offset + i + 1, pets.get(id), id, wei / 1e18, scores.get(id) ?? 0, wei / 1e18))
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
  // Abandoned = created but never ran (resolved=false, hydrated=true), the
  // terminal-unfilled state, distinct from the resolved total and from pending.
  const abandonedQuery = async () => {
    const { count: n } = await db().from("races").select("*", { count: "exact", head: true }).eq("resolved", false).eq("hydrated", true);
    return n ?? 0;
  };
  const [racesResolved, racesCreated, racesAbandoned, totalPets, hatchedPets, sale, top, price, freshPet, raceScan, lastResolved] = await Promise.all([
    count("races", ["resolved", true]),
    count("races"),
    abandonedQuery(),
    count("pets"),
    count("pets", ["hatched", true]),
    db().from("sales").select("token_id, price_eth, sold_at").not("price_eth", "is", null).order("price_eth", { ascending: false }).limit(1).maybeSingle(),
    db().from("pet_scores").select("pet_id, confirmed_quality").order("confirmed_quality", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db().from("eth_price").select("usd").eq("id", 1).maybeSingle(),
    db().from("pets").select("last_synced_at").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db().from("sync_state").select("updated_at").eq("key", "races_scan").maybeSingle(),
    // Resolution recency: the finish time of the newest race we have RESOLVED.
    // This tracks resolution, not discovery, so the "Synced" label cannot read
    // fresh while results are stale.
    db().from("races").select("resolved_at").eq("resolved", true).order("resolved_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);

  let topName: string | null = null;
  if (top.data) {
    const { data: p } = await db().from("pets").select("name").eq("id", top.data.pet_id).maybeSingle();
    topName = p?.name ?? null;
  }

  return {
    racesResolved,
    racesCreated,
    racesAbandoned,
    totalPets,
    hatchedPets,
    recentBigSale: sale.data ? { tokenId: sale.data.token_id as number, priceEth: Number(sale.data.price_eth), soldAt: sale.data.sold_at as string } : null,
    topConfirmed: top.data ? { petId: top.data.pet_id as number, name: topName, confirmedQuality: Number(top.data.confirmed_quality) } : null,
    ethUsd: price.data ? Number(price.data.usd) : null,
    petsSyncedAt: (freshPet.data?.last_synced_at as string) ?? null,
    racesScannedAt: (raceScan.data?.updated_at as string) ?? null,
    lastResolvedAt: (lastResolved.data?.resolved_at as string) ?? null,
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
    db().from("pet_scores").select("pet_id, best_distance, reveal_progress, fit_500, fit_1200, fit_2400, fit_3000").in("pet_id", ids),
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

  const recWrap = await recordsBlob();
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
      timeMs: null,
      recordNote: recWrap ? recordNoteFromBlob(recWrap.blob, id) : null,
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
  const verdict = computeVerdict(entrants, {
    payoutBps: null,
    eloThreshold: threshold,
    markedPetId,
    trackLength,
    markedFit: markedPetId != null ? markedFitMap(scoreById.get(markedPetId) as Record<string, unknown> | undefined) : undefined,
  });

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

// ---- Calibration (precomputed backtest, read-only) --------------------------
import type { CalibrationResult } from "./types";

export async function getCalibration(): Promise<CalibrationResult | null> {
  const { data, error } = await db().from("sync_state").select("value, updated_at").eq("key", "calibration_v1").maybeSingle();
  if (error) throw new Error(`calibration read failed: ${error.message}`);
  if (!data?.value) return null;
  const v = data.value as Omit<CalibrationResult, "generatedAt" | "meta">;
  return { ...v, generatedAt: (data.updated_at as string) ?? null, meta: { source: SOURCE } };
}

// ---- Stable skill (precomputed in the cron, read-only) ----------------------
import type { StableSkill, StableRow, StableLeaderboardResponse } from "./types";
import type { StableSkillBlob } from "../ingest/stableSkill";

const STABLE_EXPLANATION =
  "Stable skill: the shrunk average confirmed quality of each stable's proven horses. Proven roster quality, not racing skill, not value. Thin rosters are pulled toward the population mean; stables need at least 3 proven horses to rank.";

// The precomputed blob, read once per request and reused. A missing blob (job has
// not run yet, or the row is absent) degrades to "none"/empty, never an error.
async function stableSkillBlob(): Promise<{ blob: StableSkillBlob; computedAt: string | null } | null> {
  const { data, error } = await db().from("sync_state").select("value, updated_at").eq("key", "stable_skill_v1").maybeSingle();
  if (error || !data?.value) return null;
  return { blob: data.value as StableSkillBlob, computedAt: (data.updated_at as string) ?? null };
}

// One stable's skill, by address. ranked (>=3 proven, has rank + percentile),
// limited (1-2 proven, scored but unranked), or none (0 proven, never fabricated).
export async function getStableSkill(address: string): Promise<StableSkill> {
  const owner = address.toLowerCase();
  const none: StableSkill = { state: "none", score: null, percentile: null, rank: null, provenCount: 0, totalHorses: 0, avgProvenCq: null, eligibleTotal: 0, topPetId: null, topPetCq: null, topPetPercentile: null, topPetIsBest: false };
  const wrap = await stableSkillBlob();
  if (!wrap) return none;
  const { blob } = wrap;
  const idx = blob.board.findIndex((b) => b.address === owner);
  if (idx >= 0) {
    const b = blob.board[idx];
    return {
      state: "ranked",
      score: b.score,
      percentile: blob.eligibleTotal ? (idx + 1) / blob.eligibleTotal : null,
      rank: idx + 1,
      provenCount: b.provenCount,
      totalHorses: b.totalHorses,
      avgProvenCq: b.avgProvenCq,
      eligibleTotal: blob.eligibleTotal,
      topPetId: b.topPetId,
      topPetCq: b.topPetCq,
      topPetPercentile: b.topPetCqPercentile,
      topPetIsBest: b.topPetIsBest,
    };
  }
  const lim = blob.limited[owner];
  if (lim) {
    return { state: "limited", score: lim.score, percentile: null, rank: null, provenCount: lim.provenCount, totalHorses: lim.totalHorses, avgProvenCq: lim.avgProvenCq, eligibleTotal: blob.eligibleTotal, topPetId: lim.topPetId, topPetCq: lim.topPetCq, topPetPercentile: lim.topPetCqPercentile, topPetIsBest: lim.topPetIsBest };
  }
  return { ...none, eligibleTotal: blob.eligibleTotal };
}

// The public stable board: eligible stables (>=3 proven) ranked by score, with
// owner usernames resolved at read time, exactly like the pet leaderboards.
export async function getStableLeaderboard(limit: number, offset: number): Promise<StableLeaderboardResponse> {
  const wrap = await stableSkillBlob();
  const empty: StableLeaderboardResponse = { rows: [], limit, offset, total: 0, meta: { source: SOURCE, explanation: STABLE_EXPLANATION, popMean: 0, k: 0, computedAt: null } };
  if (!wrap) return empty;
  const { blob, computedAt } = wrap;
  const page = blob.board.slice(offset, offset + limit);
  const names = await lookupUsernames(page.map((b) => b.address));
  const rows: StableRow[] = page.map((b, i) => ({
    rank: offset + i + 1,
    ownerAddress: b.address,
    ownerName: names.get(b.address.toLowerCase()) ?? null,
    score: b.score,
    percentile: blob.eligibleTotal ? (offset + i + 1) / blob.eligibleTotal : 0,
    provenCount: b.provenCount,
    totalHorses: b.totalHorses,
    avgProvenCq: b.avgProvenCq,
  }));
  return { rows, limit, offset, total: blob.eligibleTotal, meta: { source: SOURCE, explanation: STABLE_EXPLANATION, popMean: blob.popMean, k: blob.k, computedAt } };
}

// ---- Racing records (precomputed in the cron, read-only) --------------------
import type { RecordsResponse, RecordRow, RecordMode, RecordWindow, RecordHero } from "./types";
import type { RacingRecordsBlob } from "../ingest/records";

const RECORDS_EXPLANATION_ADJ =
  "Fastest finishes from every resolved race. Hot tracks run faster, so raw times are not directly comparable. Adjusted times correct for track temperature where we have enough data; this reduces, but does not fully remove, condition effects, which is why the condition is always shown.";
const RECORDS_EXPLANATION_RAW =
  "Fastest finishes from every resolved race, on-chain times. The condition each record was set in is always shown. Not enough races at this distance to adjust for conditions yet, so these are raw times.";

async function recordsBlob(): Promise<{ blob: RacingRecordsBlob; computedAt: string | null } | null> {
  const { data, error } = await db().from("sync_state").select("value, updated_at").eq("key", "racing_records_v1").maybeSingle();
  if (error || !data?.value) return null;
  return { blob: data.value as RacingRecordsBlob, computedAt: (data.updated_at as string) ?? null };
}

// A horse's best time per distance with its rank on each board (for the dossier).
import type { PetDistanceRecord } from "./types";
function petRecordsFromBlob(blob: RacingRecordsBlob, petId: number): PetDistanceRecord[] {
  const out: PetDistanceRecord[] = [];
  for (const track of blob.tracks) {
    const raw = blob.byTrack[track]?.all?.raw ?? [];
    const adj = blob.byTrack[track]?.all?.adjusted ?? [];
    const ri = raw.findIndex((e) => e.petId === petId);
    const ai = adj.findIndex((e) => e.petId === petId);
    if (ri < 0 && ai < 0) continue;
    const rawE = ri >= 0 ? raw[ri] : null;
    const adjE = ai >= 0 ? adj[ai] : null;
    const ref = adjE ?? rawE!;
    const trackAdjusted = blob.adjustmentApplied?.[track] ?? false;
    out.push({
      track,
      bestRawMs: rawE?.rawTimeMs ?? adjE?.rawTimeMs ?? null,
      rawRank: ri >= 0 ? ri + 1 : null,
      bestAdjustedMs: trackAdjusted ? adjE?.adjustedTimeMs ?? null : null,
      adjustedRank: trackAdjusted && ai >= 0 ? ai + 1 : null,
      raceTemp: ref.raceTemp,
      raceId: ref.raceId,
    });
  }
  return out;
}

// The subtle scanner note for a horse that holds a distance record (rank 1),
// adjusted preferred. Null for everyone else.
function recordNoteFromBlob(blob: RacingRecordsBlob, petId: number): string | null {
  for (const track of blob.tracks) {
    if (blob.adjustmentApplied?.[track] && blob.byTrack[track]?.all?.adjusted?.[0]?.petId === petId) return `Holds the adjusted ${track}m record`;
  }
  for (const track of blob.tracks) if (blob.byTrack[track]?.all?.raw?.[0]?.petId === petId) return `Holds the ${track}m record`;
  return null;
}

// One records board, by track, mode (raw|adjusted), and window (all|weekly|daily).
// Reads the precomputed blob and resolves pet names and owner usernames at read
// time, exactly like the leaderboards. Adjusted times are null when the
// adjustment did not validate out of sample.
export async function getRecords(trackParam: number | null, mode: RecordMode, window: RecordWindow, limit: number, offset: number): Promise<RecordsResponse> {
  const wrap = await recordsBlob();
  const empty: RecordsResponse = {
    track: trackParam ?? 0, mode, window, adjustedAvailable: false, adjustmentApplied: false, referenceCondition: "average",
    tracks: [], adjustedTracks: [], fastest: null, limit, offset, total: 0, rows: [],
    meta: { source: SOURCE, explanation: RECORDS_EXPLANATION_ADJ, computedAt: null },
  };
  if (!wrap || wrap.blob.tracks.length === 0) return empty;
  const { blob, computedAt } = wrap;
  const track = trackParam != null && blob.tracks.includes(trackParam) ? trackParam : blob.tracks[0];
  const adjustedAvailable = blob.adjustedShipped; // some track is adjusted (controls the toggle)
  const trackApplied = blob.adjustmentApplied?.[track] ?? false; // the selected track
  const adjustedTracks = blob.tracks.filter((t) => blob.adjustmentApplied?.[t]);
  // On a non-applied track the adjusted board equals raw, so read raw there.
  const effectiveMode: RecordMode = trackApplied ? mode : "raw";
  const list = blob.byTrack[track]?.[window]?.[effectiveMode] ?? [];
  const page = list.slice(offset, offset + limit);

  // The single fastest finish across all tracks (smallest time wins, so it is the
  // shortest distance's record), the page hero. Uses the adjusted time where that
  // track is adjusted, raw otherwise.
  let heroRaw: { petId: number; track: number; timeMs: number; adjusted: boolean; raceTemp: string; raceId: number } | null = null;
  for (const t of blob.tracks) {
    const ap = blob.adjustmentApplied?.[t] ?? false;
    const top = (ap ? blob.byTrack[t]?.all?.adjusted : blob.byTrack[t]?.all?.raw)?.[0];
    if (!top) continue;
    const time = ap ? top.adjustedTimeMs : top.rawTimeMs;
    if (!heroRaw || time < heroRaw.timeMs) heroRaw = { petId: top.petId, track: t, timeMs: time, adjusted: ap, raceTemp: top.raceTemp, raceId: top.raceId };
  }

  const idsToResolve = [...page.map((e) => e.petId), ...(heroRaw ? [heroRaw.petId] : [])];
  const pets = await petsByIds(idsToResolve);
  const ownerNames = await lookupUsernames(idsToResolve.map((id) => pets.get(id)?.owner_address ?? null));
  const rows: RecordRow[] = page.map((e, i) => {
    const p = pets.get(e.petId);
    const ownerAddress = p?.owner_address ?? null;
    return {
      rank: offset + i + 1,
      petId: e.petId,
      name: p?.name ?? null,
      rarity: Number(p?.rarity ?? 0),
      ownerName: ownerAddress ? ownerNames.get(ownerAddress.toLowerCase()) ?? null : null,
      ownerAddress,
      rawTimeMs: e.rawTimeMs,
      adjustedTimeMs: trackApplied ? e.adjustedTimeMs : null, // null when this track is not adjusted
      raceTemp: e.raceTemp,
      raceId: e.raceId,
      resolvedAt: e.resolvedAt,
    };
  });
  let fastest: RecordHero | null = null;
  if (heroRaw) {
    const hp = pets.get(heroRaw.petId);
    const hAddr = hp?.owner_address ?? null;
    fastest = {
      petId: heroRaw.petId,
      name: hp?.name ?? null,
      rarity: Number(hp?.rarity ?? 0),
      ownerName: hAddr ? ownerNames.get(hAddr.toLowerCase()) ?? null : null,
      ownerAddress: hAddr,
      track: heroRaw.track,
      timeMs: heroRaw.timeMs,
      adjusted: heroRaw.adjusted,
      raceTemp: heroRaw.raceTemp,
      raceId: heroRaw.raceId,
    };
  }

  return {
    track, mode, window, adjustedAvailable, adjustmentApplied: trackApplied, referenceCondition: blob.referenceCondition,
    tracks: blob.tracks, adjustedTracks, fastest, limit, offset, total: list.length, rows,
    meta: { source: SOURCE, explanation: trackApplied ? RECORDS_EXPLANATION_ADJ : RECORDS_EXPLANATION_RAW, computedAt },
  };
}

// ---- Race Finder, live lobbies + your edge (read-only) ----------------------
import type { LobbyResponse, LobbyRow, LobbyEntrant, LobbyEdge, RaceTrackingDTO, RaceTrackEntrant } from "./types";
import { getOpenLobbies, POLL_MS, type OpenLobby } from "../lobbies";
import { fetchRace } from "../gigaverse";
import { dailyExhausted } from "../raceLimit";

const LOBBY_NOTE =
  "Live forming lobbies, polled politely and cached a few seconds, so the data may lag a little. Your edge is an estimate for the field as it stands, and it shifts as horses enter; it is not a guarantee.";

// Strength fields for an entrant or candidate horse, joined from pets + pet_scores.
interface Strength {
  name: string | null;
  ownerAddress: string | null;
  rarity: number;
  elo: number | null;
  wins: number;
  racesRun: number;
  cq: number;
  fit: Record<number, number>; // 500/1200/2400/3000
}

async function strengthByIds(ids: number[]): Promise<Map<number, Strength>> {
  const out = new Map<number, Strength>();
  if (ids.length === 0) return out;
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 300) {
    const chunk = uniq.slice(i, i + 300);
    const [{ data: pets }, { data: scores }] = await Promise.all([
      db().from("pets").select("id, name, owner_address, rarity, elo, wins, races_run").in("id", chunk),
      db().from("pet_scores").select("pet_id, confirmed_quality, fit_500, fit_1200, fit_2400, fit_3000").in("pet_id", chunk),
    ]);
    const scoreById = new Map((scores ?? []).map((s) => [s.pet_id as number, s]));
    for (const p of pets ?? []) {
      const s = scoreById.get(p.id as number) as Record<string, number> | undefined;
      out.set(p.id as number, {
        name: (p.name as string) ?? null,
        ownerAddress: (p.owner_address as string)?.toLowerCase() ?? null,
        rarity: Number(p.rarity ?? 0),
        elo: p.elo != null ? Number(p.elo) : null,
        wins: Number(p.wins ?? 0),
        racesRun: Number(p.races_run ?? 0),
        cq: Number(s?.confirmed_quality ?? 0),
        fit: { 500: Number(s?.fit_500 ?? 50), 1200: Number(s?.fit_1200 ?? 50), 2400: Number(s?.fit_2400 ?? 50), 3000: Number(s?.fit_3000 ?? 50) },
      });
    }
  }
  return out;
}

// The fit column closest to a race distance, since fit is measured at the four
// canonical lengths and lobbies can run any distance.
function nearestFitKey(track: number): number {
  const keys = [500, 1200, 2400, 3000];
  return keys.reduce((best, k) => (Math.abs(k - track) < Math.abs(best - track) ? k : best), keys[0]);
}

function oddsInput(petId: number, s: Strength, track: number) {
  return { petId, wins: s.wins, racesRun: s.racesRun, elo: s.elo, trackFit: s.fit[nearestFitKey(track)] ?? 50 };
}

// The single records board, by track, plus the user's edge. wallet ranks all of a
// roster's top horses; pet scores one horse. Read-only: no wallet signature, only
// a public address.
export async function getLobbies(walletParam: string | null, petParam: number | null): Promise<LobbyResponse> {
  const { lobbies: open, fetchedAt, delayed } = await getOpenLobbies();
  const wallet = walletParam?.toLowerCase() ?? null;

  // Candidate horses for personalized edge: a single pet, or the roster's top 20 by cq.
  let candidateIds: number[] = [];
  if (petParam != null) {
    candidateIds = [petParam];
  } else if (wallet) {
    const { data: roster } = await db()
      .from("pets").select("id").eq("owner_address", wallet).eq("hatched", true).limit(500);
    const rosterIds = (roster ?? []).map((r) => r.id as number);
    if (rosterIds.length) {
      const cq = await scoresByIds(rosterIds);
      candidateIds = [...rosterIds].sort((a, b) => (cq.get(b) ?? 0) - (cq.get(a) ?? 0)).slice(0, 20);
    }
  }
  const personalized = candidateIds.length > 0;

  // Eligibility, computed from STABLE signals so the recommendation does not flicker:
  //  - resting: hit the daily race limit, a per-pet event-count verdict that does not
  //    depend on any one race's joinability (the old per-race joinRace simulation
  //    conflated full or mid-transition races with exhaustion and oscillated).
  //  - racing: currently entered in a forming lobby, so busy and unable to join
  //    another race right now, derived from the live snapshot, also stable.
  // A pet is recommendable only if it is neither. Resting takes precedence in
  // labeling (done for the day, not just momentarily busy).
  let resting = new Set<number>();
  let racing = new Set<number>();
  if (personalized) {
    resting = await dailyExhausted(candidateIds);
    const inOpen = new Set(open.flatMap((l) => l.entries.map((e) => e.petId)));
    racing = new Set(candidateIds.filter((id) => inOpen.has(id) && !resting.has(id)));
  }
  const unavailable = new Set<number>([...resting, ...racing]);

  // Resolve strength for every entered horse + the candidates in one batch.
  const allIds = [...open.flatMap((l) => l.entries.map((e) => e.petId)), ...candidateIds];
  const strength = await strengthByIds(allIds);
  const ownerNames = await lookupUsernames([...new Set(open.flatMap((l) => l.entries.map((e) => strength.get(e.petId)?.ownerAddress ?? null)))]);

  const buildEntrant = (e: OpenLobby["entries"][number]): LobbyEntrant => {
    const s = strength.get(e.petId);
    const shrunk = s ? entrantShrunkWinRate(s.wins, s.racesRun) : 0;
    return {
      petId: e.petId,
      name: s?.name ?? null,
      ownerAddress: e.ownerAddress,
      ownerName: e.ownerAddress ? ownerNames.get(e.ownerAddress) ?? null : null,
      rarity: s?.rarity ?? 0,
      elo: s?.elo ?? null,
      confirmedQuality: s?.cq ?? 0,
      isShark: !!s && shrunk >= SHARK_WIN_RATE,
      juiced: e.juiced,
      known: !!s,
    };
  };

  const rows: LobbyRow[] = open.map((l) => {
    const entrants = l.entries.map(buildEntrant);
    const elos = entrants.map((e) => e.elo).filter((x): x is number => x != null);
    const fieldStrength = {
      avgElo: elos.length ? Math.round(elos.reduce((a, b) => a + b, 0) / elos.length) : null,
      sharkCount: entrants.filter((e) => e.isShark).length,
      topCq: entrants.reduce((m, e) => Math.max(m, e.confirmedQuality), 0),
    };

    // Personalized edge: add each candidate to the current field, take the win
    // probability the odds model gives it, keep the best. EV only for paid races.
    let edge: LobbyEdge | null = null;
    if (personalized) {
      const fieldInputs = l.entries.map((e) => { const s = strength.get(e.petId); return s ? oddsInput(e.petId, s, l.trackLength) : null; }).filter((x): x is NonNullable<typeof x> => x != null);
      // Never recommend a horse the user cannot enter: resting (daily limit) or
      // racing (busy in another forming race), both stable signals.
      const eligible = candidateIds.filter((id) => strength.has(id) && !l.entries.some((e) => e.petId === id) && !unavailable.has(id));
      let best: { petId: number; pWin: number } | null = null;
      for (const id of eligible) {
        const s = strength.get(id)!;
        const { results } = computeOdds([...fieldInputs, oddsInput(id, s, l.trackLength)]);
        const p = results.find((r) => r.petId === id)?.winProbability ?? 0;
        if (!best || p > best.pWin) best = { petId: id, pWin: p };
      }
      if (best) {
        const fee = Number(l.entryFeeWei || "0");
        const pool = Number(l.poolWei ?? "0");
        const firstBps = l.payoutBps[0] ?? 0;
        const firstPrize = (pool + fee) * (firstBps / 10000);
        // EV uses the CAPPED probability so it never inherits the uncalibrated
        // overconfident tail (a raw 0.9997 would fabricate a precise EV).
        const pForEv = Math.min(best.pWin, PWIN_CEILING);
        const evWei = fee > 0 || pool > 0 ? String(Math.round(pForEv * firstPrize - fee)) : null;
        const b = pWinBand(best.pWin);
        edge = { petId: best.petId, petName: strength.get(best.petId)?.name ?? null, pWin: best.pWin, band: b.label, bandRange: b.range, calibrated: false, evWei, eligibleCount: eligible.length };
      }
    }

    return {
      raceId: l.raceId, trackLength: l.trackLength, raceTemp: l.raceTemp,
      fieldSize: l.fieldSize, petCount: l.petCount, openSlots: l.openSlots,
      entryFeeWei: l.entryFeeWei, poolWei: l.poolWei, payoutBps: l.payoutBps,
      entrants, fieldStrength, edge,
    };
  });

  // Rank by the user's win edge when personalized, else newest/most-open first.
  if (personalized) rows.sort((a, b) => (b.edge?.pWin ?? -1) - (a.edge?.pWin ?? -1));

  // Roster eligibility summary, two stable states like dagrid: resting (used the
  // daily limit) and racing (busy in a race now). allUnavailable is honest when no
  // horse can be entered, instead of recommending a doomed entry.
  const roster = personalized
    ? {
        eligibleCount: candidateIds.length - unavailable.size,
        allUnavailable: candidateIds.length > 0 && unavailable.size === candidateIds.length,
        resting: [...resting].map((id) => ({ petId: id, name: strength.get(id)?.name ?? null })),
        racing: [...racing].map((id) => ({ petId: id, name: strength.get(id)?.name ?? null })),
      }
    : null;

  return {
    lobbies: rows,
    wallet,
    pet: petParam,
    personalized,
    rankedBy: personalized ? "edge" : "open",
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    delayed,
    pollMs: POLL_MS,
    roster,
    meta: { source: SOURCE, note: LOBBY_NOTE },
  };
}

// ---- Follow your entry, live race tracking (read-only) ----------------------
// Live race state for one race the connected wallet is in, sourced from the public
// race API on demand (a single race, not a per-race poll loop, so it is not the
// throttling pattern that was removed from the lobby path). The client polls this
// and stops at phase 3; the band is Paddock's prediction for the user's horse,
// computed from the field with the same odds engine the lobby board uses.
export async function getRaceTracking(raceId: number, pet: number): Promise<RaceTrackingDTO | null> {
  let race: Awaited<ReturnType<typeof fetchRace>> | null = null;
  try {
    race = await fetchRace(raceId);
  } catch {
    return null;
  }
  if (!race || !race.success) return null;

  const resolved = Array.isArray(race.finalRanking) && race.finalRanking.length > 0;
  const entryPetIds = (race.entries ?? []).map((e) => e.petId);
  const fieldIds = entryPetIds.length > 0 ? entryPetIds : (race.finalRanking ?? []);
  const strength = await strengthByIds([...fieldIds, pet]);

  // Prediction band: odds over the field, the user's horse already in it.
  let band: { label: string; range: string } | null = null;
  const inField = fieldIds.includes(pet);
  const inputs = fieldIds
    .map((id) => { const s = strength.get(id); return s ? oddsInput(id, s, race!.trackLength) : null; })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const candidateInputs = inField ? inputs : (strength.get(pet) ? [...inputs, oddsInput(pet, strength.get(pet)!, race.trackLength)] : inputs);
  if (candidateInputs.some((i) => i.petId === pet)) {
    const { results } = computeOdds(candidateInputs);
    const p = results.find((r) => r.petId === pet)?.winProbability;
    if (p != null) band = pWinBand(p);
  }

  const finishByPet = new Map<number, number>();
  if (resolved) race.finalRanking.forEach((id, i) => finishByPet.set(id, i + 1));
  const timeByPet = new Map<number, number>();
  if (resolved) race.finalRanking.forEach((id, i) => { if (race!.finishTimes[i] != null) timeByPet.set(id, race!.finishTimes[i]); });

  const entrantIds = resolved ? race.finalRanking : fieldIds;
  const entrants: RaceTrackEntrant[] = entrantIds.map((id) => ({
    petId: id,
    name: strength.get(id)?.name ?? null,
    finishPosition: finishByPet.get(id) ?? null,
    timeMs: timeByPet.get(id) ?? null,
    isYours: id === pet,
  }));

  const yourPayout = race.petPayouts?.[String(pet)]?.amount ?? null;

  return {
    raceId,
    phase: race.phase,
    resolved,
    trackLength: race.trackLength,
    raceTemp: race.raceTemp || null,
    fieldSize: race.fieldSize ?? entrants.length,
    petCount: entryPetIds.length || entrants.length,
    entrants,
    yourPetId: pet,
    yourName: strength.get(pet)?.name ?? null,
    yourPlacing: finishByPet.get(pet) ?? null,
    yourTimeMs: timeByPet.get(pet) ?? null,
    yourPayoutWei: yourPayout != null ? String(yourPayout) : null,
    band,
    fetchedAt: new Date().toISOString(),
  };
}

export async function findMyRaceId(wallet: string): Promise<{ raceId: number | null; petId: number | null }> {
  const { findMyRace } = await import("../raceTracker");
  const found = await findMyRace(wallet);
  return { raceId: found?.raceId ?? null, petId: found?.petId ?? null };
}

// ---- Homepage recent paid-race wins feed (read-only) ------------------------
// Real winners of PAID races (entry_fee_wei > 0), with the winner's ACTUAL take.
// The take is race_entries.payout_wei for finish_position 1, which the ingest
// writes from petPayouts[winner].amount, the winner's received payout (race
// placement plus jackpot), never the gross pool. A race whose winner has no
// recorded payout is omitted rather than guessed.
export async function getRecentWins(limit = 12): Promise<import("./types").RecentWinsResponse> {
  const { data: races } = await db()
    .from("races")
    .select("race_id, resolved_at, track_length, field_size")
    .eq("resolved", true)
    .gt("entry_fee_wei", 0) // paid races only
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(limit * 4);
  const raceRows = races ?? [];
  const raceMeta = new Map(raceRows.map((r) => [r.race_id as number, r]));
  const raceIds = raceRows.map((r) => r.race_id as number);

  const fetchedAt = new Date().toISOString();
  if (raceIds.length === 0) return { wins: [], ethUsd: null, fetchedAt };

  // Winners with a real recorded take.
  const { data: winners } = await db()
    .from("race_entries")
    .select("race_id, pet_id, owner_address, payout_wei")
    .in("race_id", raceIds)
    .eq("finish_position", 1)
    .gt("payout_wei", 0);

  const rows = (winners ?? [])
    .map((w) => ({ ...w, meta: raceMeta.get(w.race_id as number) }))
    .filter((w) => w.meta)
    .sort((a, b) => String(b.meta!.resolved_at ?? "").localeCompare(String(a.meta!.resolved_at ?? "")))
    .slice(0, limit);

  if (rows.length === 0) return { wins: [], ethUsd: null, fetchedAt };

  const [{ data: pets }, { data: price }] = await Promise.all([
    db().from("pets").select("id, name").in("id", rows.map((r) => r.pet_id as number)),
    db().from("eth_price").select("usd").eq("id", 1).maybeSingle(),
  ]);
  const nameById = new Map((pets ?? []).map((p) => [p.id as number, p.name as string | null]));
  const ownerNames = await lookupUsernames(rows.map((r) => (r.owner_address as string) ?? null));
  const ethUsd = price ? Number(price.usd) : null;

  const wins = rows.map((r) => {
    const payoutEth = Number(r.payout_wei) / 1e18;
    const addr = (r.owner_address as string) ?? null;
    return {
      raceId: r.race_id as number,
      petId: r.pet_id as number,
      petName: nameById.get(r.pet_id as number) ?? null,
      ownerAddress: addr,
      ownerName: addr ? ownerNames.get(addr.toLowerCase()) ?? null : null,
      payoutWei: String(r.payout_wei),
      payoutEth,
      payoutUsd: ethUsd != null ? payoutEth * ethUsd : null,
      trackLength: (r.meta!.track_length as number) ?? null,
      fieldSize: (r.meta!.field_size as number) ?? null,
      resolvedAt: (r.meta!.resolved_at as string) ?? null,
    };
  });

  return { wins, ethUsd, fetchedAt };
}
