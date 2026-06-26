"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useCapabilities, useSendCalls, useCallsStatus, useSendTransaction } from "wagmi";
import type { DevelopResponse, DevelopCandidate, DevelopRace, WalletSummary } from "@/lib/api/types";
import { ConnectBar } from "@/components/racefinder/EntryControls";
import { shortAddress } from "@/lib/format";
import { rarityDisplay } from "@/lib/display";
import {
  ABSTRACT_CHAIN_ID,
  PETRACING_CONTRACT,
  JOIN_RACE_SELECTOR,
  DEVELOP_MAX_BATCH,
  buildFreeJoinCall,
  buildCreateRaceTx,
  parseCreatedRaceId,
  CREATE_FIELD_MIN,
  CREATE_FIELD_MAX,
  CREATE_TRACK_LENGTHS,
  mapCreateRevert,
  revertSelector,
} from "@/lib/entry/joinRace";

// Develop Mode: race your LEAST-revealed horses into open FREE races to farm stat
// reveals, in ONE approval via EIP-5792 (wallet_sendCalls). Non-custodial and
// asset-safe: every call is value 0, and every call targets ONLY the pinned racing
// contract (enforced by buildFreeJoinCall). The flow is: select horses -> assign each
// to a free slot -> SIMULATE every call -> show the full batch (every horse, every
// race, total 0 ETH) -> one signature. If the wallet cannot do atomic batches we fall
// back to one signature each, so it never hard-fails.

type Assign = { petId: number; raceId: number };
type Dropped = { petId: number; raceId: number; reason: string };
type Phase = "select" | "creating" | "review" | "submitting" | "tracking" | "done" | "error";
type Result = { petId: number; raceId: number; ok: boolean; hash?: string };
type Mode = "fill" | "create";

const REVEAL_STATS = ["start", "speed", "stamina", "finish"] as const;

// One-click "Develop these" sets from the Stable report. The pick is a SET NAME,
// resolved fresh against the connected wallet (best-first, exactly the report order),
// so the link survives connect and a refresh re-applies the same set.
const SET_LABELS: Record<string, string> = { areteam: "A-Team", hiddengems: "Hidden Gems", nextreveals: "Next reveals" };
const PICK_STORAGE_KEY = "develop_pick";
function setIdsFor(set: string, summary: WalletSummary | null): number[] {
  if (!summary) return [];
  if (set === "areteam") return summary.aTeam.map((p) => p.id);
  if (set === "hiddengems") return summary.hiddenGems.map((p) => p.id);
  if (set === "nextreveals") return summary.revealQueue.map((r) => r.id);
  return [];
}

function pctLabel(p: number): string {
  return `${Math.round((p ?? 0) * 100)}% revealed`;
}

// Categorization (client-side, over the already-loaded develop payload). Only fields
// that exist on a candidate: status, rarity tier, revealPct, racesRun.
const STATUS_FILTERS: { key: DevelopCandidate["status"]; label: string }[] = [
  { key: "available", label: "Ready" },
  { key: "not_registered", label: "Not registered" },
  { key: "resting", label: "Resting" },
  { key: "racing", label: "Racing" },
];
const REVEAL_BUCKETS = [
  { key: "0", label: "0%", test: (p: number) => p <= 0.001 },
  { key: "1-25", label: "1-25%", test: (p: number) => p > 0.001 && p <= 0.25 },
  { key: "26-50", label: "26-50%", test: (p: number) => p > 0.25 && p <= 0.5 },
  { key: "51+", label: "51%+", test: (p: number) => p > 0.5 },
] as const;
const RACES_BUCKETS = [
  { key: "0", label: "Never raced", test: (n: number) => n === 0 },
  { key: "1-3", label: "1-3 races", test: (n: number) => n >= 1 && n <= 3 },
  { key: "4+", label: "4+ races", test: (n: number) => n >= 4 },
] as const;
const SORTS: { key: "reveal" | "rarity" | "races"; label: string }[] = [
  { key: "reveal", label: "Least revealed" },
  { key: "rarity", label: "Rarity" },
  { key: "races", label: "Fewest races" },
];

// Spread selected horses across the open free slots (most-open race first), so they
// are not all stacked into one race. Returns what fit and what did not.
function assignToSlots(order: number[], freeRaces: DevelopRace[]): { placed: Assign[]; unplaced: number[] } {
  const slots = freeRaces.map((r) => ({ raceId: r.raceId, left: r.openSlots }));
  const placed: Assign[] = [];
  const unplaced: number[] = [];
  for (const petId of order) {
    const r = slots.filter((s) => s.left > 0).sort((a, b) => b.left - a.left)[0];
    if (!r) { unplaced.push(petId); continue; }
    placed.push({ petId, raceId: r.raceId });
    r.left -= 1;
  }
  return { placed, unplaced };
}

export default function DevelopBoard({ initialWallet, initialPickSet = "" }: { initialWallet: string; initialPickSet?: string }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { sendCallsAsync } = useSendCalls();

  // CAPABILITY DETECTION: does this wallet support atomic batches on Abstract?
  const { data: caps } = useCapabilities({ account: address, chainId: ABSTRACT_CHAIN_ID, query: { enabled: !!address } });
  // EIP-5792 evolved: newer wallets report atomic.status ("supported"/"ready"),
  // older ones atomicBatch.supported. Read either, on this chain or the flat shape.
  const chainCaps = (caps as Record<string, unknown> | undefined)?.[ABSTRACT_CHAIN_ID] ?? caps;
  const atomicStatus = (chainCaps as { atomic?: { status?: string } } | undefined)?.atomic?.status;
  const atomicBatch = (chainCaps as { atomicBatch?: { supported?: boolean } } | undefined)?.atomicBatch?.supported;
  const atomicSupported = atomicStatus === "supported" || atomicStatus === "ready" || atomicBatch === true;

  const [data, setData] = useState<DevelopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<Phase>("select");
  const [plan, setPlan] = useState<{ placed: Assign[]; dropped: Dropped[]; unplaced: number[] } | null>(null);
  const [forceSequential, setForceSequential] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [batchId, setBatchId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string>("");
  // Create & Fill: create your own free race, then batch-fill it. Two signatures.
  const [mode, setMode] = useState<Mode>("fill");
  const [trackLength, setTrackLength] = useState<number>(1200);
  const [fieldSize, setFieldSize] = useState<number>(8);
  const [createdRaceId, setCreatedRaceId] = useState<number | null>(null);
  // Pre-check whether this wallet can create a race right now. Null = can create;
  // otherwise the accurate reason (unresolved created-race, or not registered). The
  // gate clears when the wallet's open created-race resolves, so we poll and re-enable.
  const [createBlock, setCreateBlock] = useState<string | null>(null);

  const connected = isConnected && !!address;
  const wallet = connected ? (address as string) : initialWallet;
  // In create mode the user can pick at most fieldSize horses; in fill mode the batch cap.
  const selectCap = mode === "create" ? fieldSize : DEVELOP_MAX_BATCH;

  // "Develop these" pick set: a SET NAME (areteam | hiddengems | nextreveals) staged
  // as a create-your-own-race. The URL is the source of truth; we also mirror it to
  // sessionStorage so the intent survives the connect round-trip even if the URL is
  // lost. Resolution is deferred until BOTH a wallet is connected AND develop data has
  // loaded, so we never flash an empty list and the eligibility is re-checked live.
  // Categorization filters (default = ready-only, least-revealed-first).
  const [statusFilter, setStatusFilter] = useState<DevelopCandidate["status"]>("available");
  const [rarityFilter, setRarityFilter] = useState<Set<number>>(new Set());
  const [revealBucket, setRevealBucket] = useState<string | null>(null);
  const [racesBucket, setRacesBucket] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"reveal" | "rarity" | "races">("reveal");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 40;

  const [pickSet, setPickSet] = useState<string>(initialPickSet);
  const [pickStage, setPickStage] = useState<"none" | "resolving" | "staged" | "empty">(initialPickSet ? "resolving" : "none");
  const [stageMsg, setStageMsg] = useState<string | null>(null);
  // The wallet's named sets, loaded once on connect, used ONLY to show eligible counts
  // on the on-page set-pick buttons. Resolution itself re-fetches live inside stagePick.
  const [pickSummary, setPickSummary] = useState<WalletSummary | null>(null);
  const [fillAlt, setFillAlt] = useState<{ slots: number; canFill: number } | null>(null);
  const pickApplied = useRef(false);
  const stagedRef = useRef<HTMLDivElement | null>(null);

  // Restore the pick from sessionStorage if it was dropped from the URL (e.g. some
  // wallet flows reload), and mirror the URL pick into storage on mount.
  useEffect(() => {
    try {
      if (initialPickSet) { sessionStorage.setItem(PICK_STORAGE_KEY, initialPickSet); return; }
      const s = sessionStorage.getItem(PICK_STORAGE_KEY);
      if (s && SET_LABELS[s]) { setPickSet(s); setPickStage("resolving"); }
    } catch { /* storage blocked: URL still carries the intent */ }
  }, [initialPickSet]);

  const load = useCallback(async () => {
    if (!wallet) { setData(null); return; }
    try {
      const res = await fetch(`/api/v1/develop?wallet=${wallet}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as DevelopResponse);
      setError(null);
    } catch {
      setError("Live data is delayed, retrying.");
    }
  }, [wallet]);

  useEffect(() => {
    load();
    const poll = setInterval(() => { if (phase === "select") load(); }, 6000);
    return () => clearInterval(poll);
  }, [load, phase]);

  // Load the wallet's named sets for the set-pick button counts (best-first membership).
  useEffect(() => {
    if (!connected || !address) { setPickSummary(null); return; }
    let alive = true;
    fetch(`/api/v1/wallet/${address}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive) setPickSummary(s as WalletSummary | null); })
      .catch(() => { /* counts simply will not show */ });
    return () => { alive = false; };
  }, [connected, address]);

  // The SINGLE pick-resolution path: resolve a SET NAME against the connected wallet,
  // re-check eligibility LIVE against the develop payload (registration-aware: only
  // status==="available" horses stage), and stage the eligible members best-first into
  // a create-your-own-race (field size = eligible count, cap 8). Handles every state:
  // empty set -> explanatory empty state; otherwise stage and (if open free slots fit)
  // offer a fill-now alternative. Used by BOTH the ?pick= arrival effect and the
  // on-page set-pick buttons, so there is exactly one implementation.
  const stagePick = useCallback(async (set: string) => {
    if (!SET_LABELS[set] || !connected || !address || !data) return;
    const label = SET_LABELS[set];
    setPickStage("resolving");
    let summary: WalletSummary | null = null;
    try {
      const res = await fetch(`/api/v1/wallet/${address}`, { cache: "no-store" });
      summary = res.ok ? ((await res.json()) as WalletSummary) : null;
    } catch { /* fall through to empty */ }
    const ids = setIdsFor(set, summary);
    const byIdLocal = new Map(data.candidates.map((c) => [c.petId, c]));
    const owned = ids.filter((id) => byIdLocal.has(id));
    const eligible = owned.filter((id) => byIdLocal.get(id)!.status === "available");
    if (eligible.length === 0) {
      setPickStage("empty");
      setStageMsg(`${label} are all racing or resting right now. They will be available after their current races resolve.`);
      return;
    }
    const chosen = eligible.slice(0, CREATE_FIELD_MAX);
    setMode("create");
    setFieldSize(chosen.length);
    setSelected(new Set(chosen));
    const dropped = owned.length - chosen.length;
    const droppedNames = owned.filter((id) => !chosen.includes(id)).slice(0, 2).map((id) => byIdLocal.get(id)?.name ?? `#${id}`).join(", ");
    setStageMsg(
      dropped > 0
        ? `Staged ${chosen.length} of ${owned.length} ${label} for a ${chosen.length}-horse race. ${droppedNames}${owned.length - chosen.length > 2 ? " and others" : ""} resting, racing, or over the cap.`
        : `Staged ${chosen.length} ${label} for a ${chosen.length}-horse race.`
    );
    setPickStage("staged");
    const slots = data.openFreeSlots ?? 0;
    setFillAlt(slots > 0 ? { slots, canFill: Math.min(slots, chosen.length) } : null);
    setTimeout(() => stagedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  }, [connected, address, data]);

  // Arrival via ?pick=<set> (or restored from storage): apply ONCE when connect + data
  // are both ready, reusing the same stagePick path the buttons use. No empty-list flash.
  useEffect(() => {
    if (pickApplied.current || !pickSet || !SET_LABELS[pickSet]) return;
    if (!connected || !address || !data) return;
    pickApplied.current = true;
    stagePick(pickSet);
  }, [pickSet, connected, address, data, stagePick]);

  // On-page set-pick buttons: stage IN PLACE, no navigation away. Mirror the choice into
  // the URL (?pick=<set>) via replaceState so the state is shareable/refreshable while the
  // SAME stagePick path runs. pickApplied stays true so the arrival effect never double-fires.
  const applyPick = useCallback((set: string) => {
    if (!SET_LABELS[set]) return;
    pickApplied.current = true;
    setPickSet(set);
    try { sessionStorage.setItem(PICK_STORAGE_KEY, set); } catch { /* storage blocked */ }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("pick", set);
      window.history.replaceState(null, "", url.toString());
    } catch { /* URL mirror is best-effort */ }
    stagePick(set);
  }, [stagePick]);

  // Create pre-check: simulate a createRace and decode the result, so the Create
  // button is disabled with the ACCURATE reason (not registered, or an unresolved
  // created-race) before the user signs. Polls while in create mode so it re-enables
  // the moment the wallet's open race resolves. Free, value 0, read-only.
  const checkCreate = useCallback(async () => {
    if (mode !== "create" || !address || !publicClient) return;
    try {
      const tx = buildCreateRaceTx(fieldSize, trackLength);
      await publicClient.estimateGas({ account: address as `0x${string}`, to: tx.to, data: tx.data, value: 0n });
      setCreateBlock(null);
    } catch (e) {
      setCreateBlock(mapCreateRevert(revertSelector(e)));
    }
  }, [mode, address, publicClient, fieldSize, trackLength]);

  useEffect(() => {
    if (mode !== "create" || phase !== "select") { setCreateBlock(null); return; }
    checkCreate();
    const iv = setInterval(checkCreate, 6000);
    return () => clearInterval(iv);
  }, [mode, phase, checkCreate]);

  // Track an atomic batch's status once submitted.
  const { data: callsStatus } = useCallsStatus({ id: batchId as string, query: { enabled: !!batchId, refetchInterval: 2000 } });
  useEffect(() => {
    if (!batchId || !callsStatus || !plan) return;
    const status = (callsStatus as { status?: string | number }).status;
    const settled = status === "success" || status === 200 || status === "CONFIRMED";
    if (settled) {
      // Atomic batch: all-or-nothing, so a settled batch means every placed call landed.
      setResults(plan.placed.map((p) => ({ petId: p.petId, raceId: p.raceId, ok: true })));
      setPhase("done");
    }
  }, [batchId, callsStatus, plan]);

  const candidates = data?.candidates ?? [];
  const freeRaces = data?.freeRaces ?? [];
  const available = candidates.filter((c) => c.status === "available"); // READY = registered + eligible
  const byId = new Map(candidates.map((c) => [c.petId, c]));
  // Eligible count for a set-pick button: set members that are READY (registered +
  // available) right now, the same registration-aware gate stagePick uses.
  const eligibleCount = (set: string) => setIdsFor(set, pickSummary).filter((id) => byId.get(id)?.status === "available").length;
  const PICK_BUTTONS: { set: string; label: string }[] = [
    { set: "areteam", label: "Develop my A-Team" },
    { set: "hiddengems", label: "Develop my Hidden Gems" },
    { set: "nextreveals", label: "Develop next reveals" },
  ];

  // Per-status counts (over the full pool) for the status segment.
  const statusCounts: Record<string, number> = { available: 0, not_registered: 0, resting: 0, racing: 0 };
  for (const c of candidates) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
  // Current status slice, the population the other filters refine.
  const inStatus = candidates.filter((c) => c.status === statusFilter);
  const rarityTiers = [...new Set(inStatus.map((c) => c.rarity))].sort((a, b) => b - a);
  const rarityCount = (t: number) => inStatus.filter((c) => c.rarity === t).length;
  // Filtered + sorted (client-side, over already-loaded data).
  const visible = inStatus
    .filter((c) => rarityFilter.size === 0 || rarityFilter.has(c.rarity))
    .filter((c) => !revealBucket || (REVEAL_BUCKETS.find((b) => b.key === revealBucket)?.test(c.revealPct) ?? true))
    .filter((c) => !racesBucket || (RACES_BUCKETS.find((b) => b.key === racesBucket)?.test(c.racesRun) ?? true))
    .sort((a, b) =>
      sortBy === "rarity" ? b.rarity - a.rarity || a.revealPct - b.revealPct
      : sortBy === "races" ? a.racesRun - b.racesRun || a.revealPct - b.revealPct
      : a.revealPct - b.revealPct || b.rarity - a.rarity // reveal (default): least-revealed, then rarity desc
    );
  const paged = visible.slice(0, page * PAGE_SIZE); // paginate so a 332-horse stable stays snappy
  const anyFilter = rarityFilter.size > 0 || revealBucket != null || racesBucket != null;

  // LIVE assignment, shown as the user selects (not hidden until review). This is the
  // EXACT placement the batch will use: selected horses are assigned best-development-
  // need first (candidate order) into open free slots; overflow has no slot and is
  // excluded. assignToSlots is deterministic, so what is shown is what is submitted.
  const selectedOrder = available.filter((c) => selected.has(c.petId)).map((c) => c.petId);
  const liveAssign = assignToSlots(selectedOrder, freeRaces);
  const raceForPet = new Map(liveAssign.placed.map((p) => [p.petId, p.raceId]));
  const unplacedSet = new Set(liveAssign.unplaced);

  function toggle(petId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(petId)) next.delete(petId);
      else if (next.size < selectCap) next.add(petId);
      return next;
    });
  }

  // Filter handlers (reset pagination on any change).
  function setStatusSeg(s: DevelopCandidate["status"]) { setStatusFilter(s); setPage(1); }
  function toggleRarity(t: number) { setRarityFilter((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; }); setPage(1); }
  function clearFilters() { setRarityFilter(new Set()); setRevealBucket(null); setRacesBucket(null); setPage(1); }
  // Filter then stage: select every READY horse currently shown, capped at the field size.
  function selectAllShown() {
    const ids = visible.filter((c) => c.status === "available").map((c) => c.petId).slice(0, selectCap);
    setSelected(new Set(ids));
    if (mode === "create") setFieldSize(Math.min(CREATE_FIELD_MAX, Math.max(CREATE_FIELD_MIN, ids.length || CREATE_FIELD_MIN)));
  }

  // Manual horse-ID add: validate ownership + eligibility against the wallet's own
  // candidate set (which is exactly its hatched horses) before adding to the batch.
  // Returns an error message or null. The per-call simulation in review() is the final
  // guard, so a horse that slips through still cannot enter a doomed batch.
  const addById = useCallback((petId: number): string | null => {
    const c = candidates.find((x) => x.petId === petId);
    if (!c) return `You do not own #${petId}, or it is not race-ready.`;
    if (c.status === "not_registered") return `#${petId} is not registered for racing on Gigaverse yet.`;
    if (c.status !== "available") return `#${petId} is ${c.status === "racing" ? "racing now" : "resting (daily limit)"}.`;
    if (selected.has(petId)) return `#${petId} is already selected.`;
    if (selected.size >= selectCap) return `You can select at most ${selectCap}.`;
    setSelected((prev) => new Set(prev).add(petId));
    return null;
  }, [candidates, selected, selectCap]);

  // SIMULATE every assigned call at value 0. Only calls that simulate green enter the
  // batch; reverting ones are dropped and surfaced, so an all-or-nothing batch can
  // never be submitted with a doomed call inside it. Shared by fill and create modes.
  const runReview = useCallback(async (assignments: Assign[], unplaced: number[]) => {
    if (!publicClient) { setError("Wallet client unavailable, reconnect."); return; }
    const sims = await Promise.all(
      assignments.map(async (p) => {
        try {
          const call = buildFreeJoinCall(p.raceId, p.petId); // asserts contract + value 0
          await publicClient.estimateGas({ account: address as `0x${string}`, to: call.to, data: call.data, value: 0n });
          return { p, ok: true as const };
        } catch {
          return { p, ok: false as const };
        }
      })
    );
    const green = sims.filter((s) => s.ok).map((s) => s.p);
    const dropped: Dropped[] = sims.filter((s) => !s.ok).map((s) => ({ ...s.p, reason: "would not enter right now (race may have just filled)" }));
    setPlan({ placed: green, dropped, unplaced });
    setPhase("review");
  }, [publicClient, address]);

  // FILL mode: assign selected -> open free slots, then review.
  const review = useCallback(async () => {
    setNote("");
    const order = available.filter((c) => selected.has(c.petId)).map((c) => c.petId);
    if (order.length === 0) return;
    const { placed, unplaced } = assignToSlots(order, freeRaces);
    await runReview(placed, unplaced);
  }, [available, selected, freeRaces, runReview]);

  // CREATE mode, Step 1: create your own FREE race (value 0), read its raceId from the
  // receipt, then move to Step 2 (the batched fill into that new race). createRace
  // requires a registered Gigaverse account, so the pre-sign simulation gates an
  // unregistered wallet with a clear message instead of submitting a doomed tx.
  const createAndFill = useCallback(async () => {
    setError(null); setNote("");
    const order = available.filter((c) => selected.has(c.petId)).map((c) => c.petId).slice(0, fieldSize);
    if (order.length === 0) { setError("Select at least one of your horses to enter."); return; }
    if (!publicClient || !address) { setError("Wallet client unavailable, reconnect."); return; }
    let tx: { to: `0x${string}`; data: `0x${string}`; value: bigint };
    try {
      const t = buildCreateRaceTx(fieldSize, trackLength);
      tx = { to: t.to, data: t.data, value: t.value };
    } catch {
      setError("Invalid race configuration."); return;
    }
    setPhase("creating");
    // Decode the exact revert reason (unresolved created-race, not registered, or
    // other) and show that, never a wrong reason.
    try {
      await publicClient.estimateGas({ account: address as `0x${string}`, to: tx.to, data: tx.data, value: 0n });
    } catch (e) {
      const reason = mapCreateRevert(revertSelector(e));
      setError(reason);
      setCreateBlock(reason);
      setPhase("select");
      return;
    }
    let hash: `0x${string}`;
    try {
      hash = await sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value });
    } catch (e: unknown) {
      const m = (e as { message?: string })?.message ?? "";
      setNote(/reject|denied|User rejected/i.test(m) ? "You rejected the race creation. Nothing was created." : (m.slice(0, 140) || "Race creation failed."));
      setPhase("select");
      return;
    }
    setNote("Race creation sent. Reading the new race id.");
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const raceId = parseCreatedRaceId(receipt.logs);
      if (raceId == null) { setError("Your race was created but Paddock could not read its id. Check your Stable, then fill it from the open races."); setPhase("select"); return; }
      setCreatedRaceId(raceId);
      setNote(`Race #${raceId} created. Step 2: review and enter your horses.`);
      // Step 2: fill the new race with the selected horses (per-call simulated).
      await runReview(order.map((petId) => ({ petId, raceId })), []);
    } catch {
      setError("Race creation could not be confirmed on-chain. Try filling from the open races.");
      setPhase("select");
    }
  }, [available, selected, fieldSize, trackLength, publicClient, address, sendTransactionAsync, runReview]);

  // Submit the reviewed batch. Atomic if supported (one approval), else sequential
  // (one signature per horse) so it always works.
  const submit = useCallback(async () => {
    if (!plan || plan.placed.length === 0) return;
    setPhase("submitting");
    setNote("");
    // Build + assert every call (contract allowlist + value 0) ONE more time right
    // before signing, never trusting state built earlier.
    let calls: { to: `0x${string}`; data: `0x${string}`; value: bigint }[];
    try {
      calls = plan.placed.map((p) => {
        const c = buildFreeJoinCall(p.raceId, p.petId);
        return { to: c.to, data: c.data, value: 0n };
      });
    } catch {
      setError("Could not build a safe batch. Nothing was signed.");
      setPhase("error");
      return;
    }

    const useAtomic = atomicSupported && !forceSequential;
    try {
      if (useAtomic) {
        const res = await sendCallsAsync({ calls });
        const id = typeof res === "string" ? res : (res as { id?: string })?.id;
        setBatchId(id);
        setPhase("tracking");
        setNote(`Submitted ${calls.length} entries in one approval. Confirming on-chain.`);
      } else {
        // Sequential fallback: one signature each. Partial success is possible and is
        // reported per horse.
        const out: Result[] = [];
        for (const p of plan.placed) {
          try {
            const c = buildFreeJoinCall(p.raceId, p.petId);
            const hash = await sendTransactionAsync({ to: c.to, data: c.data, value: 0n });
            out.push({ petId: p.petId, raceId: p.raceId, ok: true, hash });
          } catch {
            out.push({ petId: p.petId, raceId: p.raceId, ok: false });
          }
          setResults([...out]);
        }
        setPhase("done");
      }
    } catch (e: unknown) {
      const m = (e as { message?: string })?.message ?? "";
      if (/reject|denied|User rejected/i.test(m)) { setNote("You rejected the batch. Nothing was entered."); setPhase("review"); }
      else { setError(m.slice(0, 160) || "The batch failed. Nothing was entered."); setPhase("error"); }
    }
  }, [plan, atomicSupported, forceSequential, sendCallsAsync, sendTransactionAsync]);

  function reset() {
    setSelected(new Set());
    setPlan(null);
    setResults([]);
    setBatchId(undefined);
    setCreatedRaceId(null);
    setNote("");
    setError(null);
    setPhase("select");
    load();
  }

  // Manual mode switch keeps the current selection (never traps the user). Switching
  // to create sizes the field to fit the selection.
  function switchMode(m: Mode) {
    setMode(m);
    if (m === "create" && selected.size > 0) setFieldSize(Math.min(CREATE_FIELD_MAX, Math.max(CREATE_FIELD_MIN, selected.size)));
  }
  // State D: develop the staged set immediately in open free races instead of waiting
  // for the create gate to clear. Explicit choice; keeps the selection.
  function fillNow() {
    setMode("fill");
  }

  // STATE A: arrived via a pick link but not connected. Keep the intent (URL +
  // sessionStorage), show the connect prompt with the staged-set banner, and auto-apply
  // the instant the wallet connects (the resolution effect fires on `connected`).
  if (pickSet && SET_LABELS[pickSet] && !connected) {
    return (
      <div>
        <ConnectBar />
        <div className="panel mt-2 p-6 text-center">
          <p className="type-card-title text-ink">Connect to stage your {SET_LABELS[pickSet]} for a race</p>
          <p className="type-body mt-1 text-ink-soft">
            Connect your Abstract wallet and Paddock will stage your {SET_LABELS[pickSet]} into a free race to develop, ready for you to review and sign. Free, zero ETH. Nothing is lost when you connect.
          </p>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div>
        <ConnectBar />
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">Connect to develop your horses</p>
          <p className="type-body mt-1 text-ink-soft">Develop Mode races your least-revealed Giglings into free races to farm stat reveals in bulk, one approval, zero ETH.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ConnectBar />

      {/* Freshness + capability path, surfaced honestly. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="type-micro normal-case text-ink-faint">
          {data ? `${available.length} ready to develop, ${data.openFreeSlots} free ${data.openFreeSlots === 1 ? "slot" : "slots"} open now` : "Loading your horses"}
        </span>
        <span className="type-micro uppercase tracking-wider text-ink-faint">
          {atomicSupported ? "One-signature batch" : "One signature per horse"}
        </span>
      </div>

      {error && phase !== "error" && <p className="type-micro mb-3 normal-case" style={{ color: "var(--gold)" }}>{error}</p>}

      {/* One-click set picks, native to Develop: stage a named set IN PLACE (no trip to
          Stable). Same stagePick path as ?pick=; counts are registration-aware. */}
      {phase === "select" && connected && data && pickStage !== "resolving" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="type-micro uppercase tracking-wider text-ink-faint">Quick sets:</span>
          {PICK_BUTTONS.map(({ set, label }) => {
            const n = eligibleCount(set);
            const active = pickSet === set && pickStage === "staged";
            return (
              <button
                key={set}
                onClick={() => applyPick(set)}
                aria-pressed={active}
                className="type-micro uppercase tracking-wider rounded-md border px-3 py-1.5 transition-paddock"
                style={{ borderColor: active ? "var(--glow)" : "var(--line-strong)", color: active ? "var(--glow)" : "var(--ink-soft)", background: active ? "color-mix(in srgb, var(--glow) 12%, transparent)" : "transparent" }}
              >
                {label}{pickSummary ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* ONE consistent status region (aria-live): the staged-set summary and the
          create gate reason, updating in place as state changes. The Create CTA points
          its disabled reason here via aria-describedby. */}
      {phase === "select" && (stageMsg || (mode === "create" && createBlock)) && (
        <div id="develop-status" aria-live="polite" className="mb-3 rounded-md border px-3 py-2.5" style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}>
          {stageMsg && <p className="type-data text-ink-soft">{stageMsg}</p>}
          {mode === "create" && createBlock && (
            <p className="type-micro mt-1 normal-case" style={{ color: "var(--gold)" }}>{createBlock} Paddock re-checks automatically.</p>
          )}
          {/* STATE D: gated, but open free slots fit the staged set, so offer to fill now. */}
          {mode === "create" && createBlock && fillAlt && fillAlt.slots > 0 && (
            <button onClick={fillNow} className="type-micro uppercase tracking-wider mt-2 rounded-md border px-3 py-1.5 text-ink transition-paddock hover:border-glow" style={{ borderColor: "var(--line-strong)" }}>
              Or fill open races now ({fillAlt.slots} {fillAlt.slots === 1 ? "slot" : "slots"} open{fillAlt.canFill < selected.size ? `, fills ${fillAlt.canFill} of ${selected.size}` : ""})
            </button>
          )}
        </div>
      )}

      {/* No empty-list flash: while a pick is resolving, show a brief staging state. */}
      {phase === "select" && pickStage === "resolving" && (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">Staging your {SET_LABELS[pickSet] ?? "set"}</p>
          <p className="type-body mt-1 text-ink-soft">Checking which horses are ready and building your race.</p>
        </div>
      )}

      {/* STATE E: the set has zero currently-eligible members. */}
      {phase === "select" && pickStage === "empty" && (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">{stageMsg ?? "No horses ready right now."}</p>
          <p className="type-micro mt-3 normal-case">
            <Link href="/stable" className="transition-paddock hover:text-glow" style={{ color: "var(--glow)" }}>Back to your stable</Link>
          </p>
        </div>
      )}

      {/* Mode: fill open free races, or create your own and pack it with your horses. */}
      {phase === "select" && pickStage !== "resolving" && pickStage !== "empty" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(["fill", "create"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className="type-micro uppercase tracking-wider rounded-md border px-3 py-1.5 transition-paddock"
              style={{ borderColor: mode === m ? "var(--glow)" : "var(--line-strong)", color: mode === m ? "var(--glow)" : "var(--ink-faint)", background: mode === m ? "color-mix(in srgb, var(--glow) 12%, transparent)" : "transparent" }}
            >
              {m === "fill" ? "Fill open races" : "Create your own race"}
            </button>
          ))}
        </div>
      )}

      {/* CREATE config: track length + field size, before picking horses. */}
      {phase === "select" && mode === "create" && pickStage !== "resolving" && pickStage !== "empty" && (
        <div className="panel mb-3 p-4">
          <p className="eyebrow">Step 1: your race</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="type-micro mb-1.5 uppercase tracking-wider text-ink-faint">Distance</p>
              <div className="flex flex-wrap gap-1.5">
                {CREATE_TRACK_LENGTHS.map((t) => (
                  <button key={t} onClick={() => setTrackLength(t)} aria-pressed={trackLength === t}
                    className="type-data rounded-md border px-2.5 py-1.5 transition-paddock"
                    style={{ borderColor: trackLength === t ? "var(--glow)" : "var(--line-strong)", color: trackLength === t ? "var(--glow)" : "var(--ink-soft)" }}>{t}m</button>
                ))}
              </div>
            </div>
            <div>
              <p className="type-micro mb-1.5 uppercase tracking-wider text-ink-faint">Field size</p>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: CREATE_FIELD_MAX - CREATE_FIELD_MIN + 1 }, (_, i) => i + CREATE_FIELD_MIN).map((n) => (
                  <button key={n} onClick={() => { setFieldSize(n); setSelected((prev) => new Set([...prev].slice(0, n))); }} aria-pressed={fieldSize === n}
                    className="type-data rounded-md border px-2.5 py-1.5 transition-paddock"
                    style={{ borderColor: fieldSize === n ? "var(--glow)" : "var(--line-strong)", color: fieldSize === n ? "var(--glow)" : "var(--ink-soft)" }}>{n}</button>
                ))}
              </div>
            </div>
          </div>
          <p className="type-micro mt-3 normal-case text-ink-faint">A free race ({trackLength}m, up to {fieldSize} horses, 0 ETH). Step 1 creates it (one signature), Step 2 enters your selected horses in one batch.</p>
        </div>
      )}

      {/* SELECT */}
      {phase === "select" && pickStage !== "resolving" && pickStage !== "empty" && (
        <>
          {candidates.length === 0 ? (
            <div className="panel p-8 text-center">
              <p className="type-card-title text-ink">No horses found for this wallet</p>
              <p className="type-body mt-1 text-ink-soft">If you just received one, ownership can take a moment to index.</p>
            </div>
          ) : (
            <>
              {/* FILTER BAR: slice the stable instead of scrolling 222 rows. One control
                  region: status segment, rarity, reveal, races, sort, active chips. */}
              <div className="mb-3 flex flex-col gap-2.5 rounded-md border p-3" style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}>
                <FilterRow label="Status">
                  {STATUS_FILTERS.map((s) => (
                    <Pill key={s.key} active={statusFilter === s.key} onClick={() => setStatusSeg(s.key)} label={`${s.label} ${statusCounts[s.key] ?? 0}`} />
                  ))}
                </FilterRow>
                {rarityTiers.length > 0 && (
                  <FilterRow label="Rarity">
                    {rarityTiers.map((t) => {
                      const r = rarityDisplay(t);
                      return <Pill key={t} active={rarityFilter.has(t)} onClick={() => toggleRarity(t)} label={`${r.name} ${rarityCount(t)}`} color={r.color} />;
                    })}
                  </FilterRow>
                )}
                <FilterRow label="Reveal">
                  {REVEAL_BUCKETS.map((b) => (
                    <Pill key={b.key} active={revealBucket === b.key} onClick={() => { setRevealBucket(revealBucket === b.key ? null : b.key); setPage(1); }} label={b.label} />
                  ))}
                </FilterRow>
                <FilterRow label="Races">
                  {RACES_BUCKETS.map((b) => (
                    <Pill key={b.key} active={racesBucket === b.key} onClick={() => { setRacesBucket(racesBucket === b.key ? null : b.key); setPage(1); }} label={b.label} />
                  ))}
                </FilterRow>
                <FilterRow label="Sort">
                  {SORTS.map((s) => (
                    <Pill key={s.key} active={sortBy === s.key} onClick={() => setSortBy(s.key)} label={s.label} />
                  ))}
                </FilterRow>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span aria-live="polite" className="type-micro normal-case text-ink-faint">
                    {visible.length} {STATUS_FILTERS.find((s) => s.key === statusFilter)?.label.toLowerCase()} horse{visible.length === 1 ? "" : "s"} shown{anyFilter ? ", filtered" : ""}.
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {anyFilter && <button onClick={clearFilters} className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">Clear filters</button>}
                    {statusFilter === "available" && visible.length > 0 && (
                      <button onClick={selectAllShown} className="type-micro uppercase tracking-wider rounded-md border px-3 py-1.5 text-ink transition-paddock hover:border-glow" style={{ borderColor: "var(--line-strong)" }}>
                        Select all shown ({Math.min(visible.length, selectCap)})
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="panel p-8 text-center">
                  <p className="type-card-title text-ink">No horses match these filters</p>
                  <p className="type-body mt-1 text-ink-soft">Loosen a filter to see more of your stable.</p>
                </div>
              ) : (
                <div ref={stagedRef} className="grid gap-2">
                  {paged.map((c) => (
                    <DevelopRow
                      key={c.petId}
                      c={c}
                      selected={selected.has(c.petId)}
                      disabled={c.status !== "available" || (!selected.has(c.petId) && selected.size >= selectCap)}
                      assignedRace={mode === "fill" && selected.has(c.petId) ? raceForPet.get(c.petId) ?? null : undefined}
                      noSlot={mode === "fill" && selected.has(c.petId) && unplacedSet.has(c.petId)}
                      onToggle={() => toggle(c.petId)}
                    />
                  ))}
                  {visible.length > paged.length && (
                    <button onClick={() => setPage((p) => p + 1)} className="type-micro uppercase tracking-wider mt-1 rounded-md border px-3 py-2 text-ink-faint transition-paddock hover:text-ink" style={{ borderColor: "var(--line-strong)" }}>
                      Show {Math.min(PAGE_SIZE, visible.length - paged.length)} more ({visible.length - paged.length} left)
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Manual horse-ID add, alongside the ranked picker. */}
          {candidates.length > 0 && <DevelopManualAdd onAdd={addById} />}

          {/* Action bar: capacity + the mode's action. */}
          <div className="sticky bottom-3 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}>
            {mode === "fill" ? (
              <span className="type-data text-ink-soft">
                {selected.size} selected{selected.size >= selectCap ? ` (max ${selectCap})` : ""}, {data?.openFreeSlots ?? 0} free {(data?.openFreeSlots ?? 0) === 1 ? "slot" : "slots"} open
                {unplacedSet.size > 0 ? <span style={{ color: "var(--gold)" }}>, {unplacedSet.size} cannot be placed</span> : ""}
              </span>
            ) : (
              <span className="type-data text-ink-soft">{selected.size} of up to {fieldSize} selected for your {trackLength}m race</span>
            )}
            {mode === "fill" ? (
              <button onClick={review} disabled={selected.size === 0 || freeRaces.length === 0} className="type-data rounded-md px-5 py-2.5 disabled:opacity-40" style={{ background: "var(--action)", color: "#14110f" }}>
                Review batch
              </button>
            ) : (
              <button onClick={createAndFill} disabled={selected.size === 0 || createBlock != null} aria-describedby={createBlock != null ? "develop-status" : undefined} className="type-data rounded-md px-5 py-2.5 disabled:opacity-40" style={{ background: "var(--action)", color: "#14110f" }}>
                {createBlock != null ? "Can't create yet" : "Create race (Step 1)"}
              </button>
            )}
          </div>
        </>
      )}

      {phase === "creating" && (
        <div className="panel mt-4 p-5 text-center">
          <p className="type-card-title text-ink">Creating your race</p>
          <p className="type-body mt-1 text-ink-soft">{note || "Confirm the race creation in your wallet (Step 1 of 2). This creates a free race at 0 ETH."}</p>
        </div>
      )}

      {/* REVIEW: the full batch, every horse, every race, total 0 ETH. */}
      {phase === "review" && plan && (
        <BatchReview
          plan={plan}
          byId={byId}
          atomicSupported={atomicSupported}
          forceSequential={forceSequential}
          onToggleSequential={() => setForceSequential((v) => !v)}
          onBack={() => setPhase("select")}
          onConfirm={submit}
          note={note}
        />
      )}

      {(phase === "submitting" || phase === "tracking") && (
        <div className="panel mt-4 p-5 text-center">
          <p className="type-card-title text-ink">{phase === "submitting" ? "Confirm in your wallet" : "Confirming on-chain"}</p>
          <p className="type-body mt-1 text-ink-soft">{note || "Your wallet is signing the batch. Paddock never holds your keys or funds."}</p>
        </div>
      )}

      {phase === "done" && (
        <ResultsPanel results={results.length ? results : (plan?.placed ?? []).map((p) => ({ ...p, ok: true }))} byId={byId} dropped={plan?.dropped ?? []} unplaced={plan?.unplaced ?? []} onReset={reset} />
      )}

      {phase === "error" && (
        <div className="panel mt-4 p-5">
          <p className="type-card-title" style={{ color: "var(--brick)" }}>Batch not submitted</p>
          <p className="type-body mt-1 text-ink-soft">{error}</p>
          <button onClick={() => setPhase("review")} className="type-data mt-3 rounded-md border px-4 py-2 text-ink" style={{ borderColor: "var(--line-strong)" }}>Back to review</button>
        </div>
      )}
    </div>
  );
}

function DevelopManualAdd({ onAdd }: { onAdd: (petId: number) => string | null }) {
  const [id, setId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const go = () => {
    const petId = Number(id);
    if (!Number.isInteger(petId) || petId <= 0) { setMsg("Enter a numeric horse ID."); return; }
    const err = onAdd(petId);
    setMsg(err);
    if (!err) setId("");
  };
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="type-micro uppercase tracking-wider text-ink-faint">add by ID</span>
        <input
          value={id}
          onChange={(e) => setId(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          inputMode="numeric"
          placeholder="e.g. 4967"
          aria-label="Add a specific horse by ID"
          className="type-data w-24 rounded-md border bg-transparent px-2 py-1.5 text-ink outline-none focus-visible:border-glow"
          style={{ borderColor: "var(--line-strong)" }}
        />
        <button onClick={go} disabled={!id} className="type-micro uppercase tracking-wider rounded-md border px-3 py-1.5 text-ink transition-paddock hover:border-glow disabled:opacity-40" style={{ borderColor: "var(--line-strong)" }}>add</button>
      </div>
      {msg && <p className="type-micro mt-1.5 normal-case" style={{ color: "var(--gold)" }}>{msg}</p>}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="type-micro uppercase tracking-wider text-ink-faint" style={{ minWidth: 52 }}>{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// Pill toggle, consistent with the Records page filters. Rarity color is never the
// only signal, the label always carries the tier name.
function Pill({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  const c = color ?? "var(--glow)";
  return (
    <button onClick={onClick} aria-pressed={active} className="type-micro rounded-full border px-2.5 py-1 transition-paddock"
      style={{ borderColor: active ? c : "var(--line-strong)", color: active ? c : "var(--ink-faint)", background: active ? `color-mix(in srgb, ${c} 14%, transparent)` : "transparent" }}>
      {color && <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} aria-hidden />}
      {label}
    </button>
  );
}

function DevelopRow({ c, selected, disabled, assignedRace, noSlot, onToggle }: { c: DevelopCandidate; selected: boolean; disabled: boolean; assignedRace?: number | null; noSlot?: boolean; onToggle: () => void }) {
  const statusLabel =
    c.status === "available" ? null
    : c.status === "racing" ? "racing now"
    : c.status === "not_registered" ? "not registered"
    : "resting (daily limit)";
  return (
    <button
      onClick={onToggle}
      disabled={disabled && !selected}
      className="panel flex w-full items-center justify-between gap-3 p-3 text-left transition-paddock disabled:opacity-40"
      style={{ borderColor: selected ? "var(--glow)" : undefined }}
      aria-pressed={selected}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border" style={{ borderColor: selected ? "var(--glow)" : "var(--line-strong)", background: selected ? "var(--glow)" : "transparent" }} aria-hidden>
          {selected && <span style={{ color: "#14110f", fontSize: 12 }}>✓</span>}
        </span>
        <div>
          <Link href={`/pet/${c.petId}`} onClick={(e) => e.stopPropagation()} className="type-data text-ink transition-paddock hover:text-glow">{c.name ?? `#${c.petId}`}</Link>
          <p className="type-micro normal-case text-ink-faint">
            {rarityDisplay(c.rarity).name}, {pctLabel(c.revealPct)}, {c.racesRun} races run
          </p>
          {c.status === "not_registered" && <p className="type-micro normal-case" style={{ color: "var(--gold)" }}>Register on Gigaverse to race this horse.</p>}
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        {/* The race this horse will enter, shown inline as soon as it is selected, so
            the assignment is never a black box until review. */}
        {selected && noSlot && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--gold)" }}>no open slot</span>}
        {selected && !noSlot && assignedRace != null && (
          <span className="type-micro uppercase tracking-wider" style={{ color: "var(--glow)" }}>→ race #{assignedRace}</span>
        )}
        <span className="type-micro uppercase tracking-wider" style={{ color: statusLabel ? "var(--ink-faint)" : "var(--green)" }}>
          {statusLabel ?? "ready"}
        </span>
      </div>
    </button>
  );
}

function BatchReview({ plan, byId, atomicSupported, forceSequential, onToggleSequential, onBack, onConfirm, note }: {
  plan: { placed: Assign[]; dropped: Dropped[]; unplaced: number[] };
  byId: Map<number, DevelopCandidate>;
  atomicSupported: boolean;
  forceSequential: boolean;
  onToggleSequential: () => void;
  onBack: () => void;
  onConfirm: () => void;
  note: string;
}) {
  const name = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const useAtomic = atomicSupported && !forceSequential;
  return (
    <div className="panel mt-4 p-5">
      <p className="eyebrow">Confirm this batch</p>
      <h2 className="type-card-title text-ink">Develop {plan.placed.length} {plan.placed.length === 1 ? "horse" : "horses"}</h2>
      <p className="type-micro mt-1 normal-case text-ink-faint">
        {useAtomic ? "One approval enters all of these at once." : "You will sign one transaction per horse."} Every call goes to {shortAddress(PETRACING_CONTRACT)} (PetRacingSystem), method join ({JOIN_RACE_SELECTOR}).
      </p>

      {/* Every call, explicit. */}
      <ul className="mt-3 divide-y" style={{ borderColor: "var(--line-strong)" }}>
        {plan.placed.map((p) => (
          <li key={p.petId} className="flex items-center justify-between gap-3 py-2">
            <span className="type-data text-ink">{name(p.petId)}</span>
            <span className="type-micro normal-case text-ink-faint">into race #{p.raceId}, value 0 ETH</span>
          </li>
        ))}
      </ul>

      {/* The total, stated plainly. */}
      <div className="mt-3 flex items-center justify-between rounded-md border p-3" style={{ borderColor: "var(--line-strong)" }}>
        <span className="type-micro uppercase tracking-wider text-ink-faint">Total you send</span>
        <span className="type-data" style={{ color: "var(--green)" }}>0 ETH ({plan.placed.length} free {plan.placed.length === 1 ? "entry" : "entries"})</span>
      </div>

      {(plan.dropped.length > 0 || plan.unplaced.length > 0) && (
        <p className="type-micro mt-2 normal-case" style={{ color: "var(--gold)" }}>
          {plan.dropped.length > 0 ? `Skipped (would not enter): ${plan.dropped.map((d) => name(d.petId)).join(", ")}. ` : ""}
          {plan.unplaced.length > 0 ? `No free slot for: ${plan.unplaced.map(name).join(", ")}. ` : ""}
          These were left out so the rest still go through.
        </p>
      )}

      <label className="mt-3 flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={forceSequential} onChange={onToggleSequential} />
        <span className="type-micro normal-case text-ink-faint">Sign one at a time instead of one batch{!atomicSupported ? " (your wallet does not support batching)" : ""}</span>
      </label>

      {note && <p className="type-micro mt-2 normal-case" style={{ color: "var(--gold)" }}>{note}</p>}

      <div className="mt-4 flex gap-2">
        <button onClick={onBack} className="type-data rounded-md border px-4 py-2.5 text-ink" style={{ borderColor: "var(--line-strong)" }}>Back</button>
        <button onClick={onConfirm} disabled={plan.placed.length === 0} className="type-data flex-1 rounded-md px-4 py-2.5 disabled:opacity-40" style={{ background: "var(--action)", color: "#14110f" }}>
          {useAtomic ? `Enter ${plan.placed.length} in one signature` : `Sign ${plan.placed.length} ${plan.placed.length === 1 ? "entry" : "entries"}`}
        </button>
      </div>
    </div>
  );
}

function ResultsPanel({ results, byId, dropped, unplaced, onReset }: { results: Result[]; byId: Map<number, DevelopCandidate>; dropped: Dropped[]; unplaced: number[]; onReset: () => void }) {
  const name = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="panel mt-4 p-5">
      <p className="eyebrow">Develop batch</p>
      <h2 className="type-card-title" style={{ color: "var(--green)" }}>{ok.length} entered</h2>
      <ul className="mt-3 space-y-1">
        {ok.map((r) => <li key={r.petId} className="type-data text-ink-soft">{name(r.petId)} entered race #{r.raceId}</li>)}
        {failed.map((r) => <li key={r.petId} className="type-data" style={{ color: "var(--gold)" }}>{name(r.petId)} did not enter race #{r.raceId}</li>)}
      </ul>
      {(dropped.length > 0 || unplaced.length > 0) && (
        <p className="type-micro mt-2 normal-case text-ink-faint">
          Left out beforehand: {[...dropped.map((d) => name(d.petId)), ...unplaced.map(name)].join(", ")}.
        </p>
      )}
      <button onClick={onReset} className="type-data mt-4 rounded-md px-4 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>Develop more</button>
    </div>
  );
}
