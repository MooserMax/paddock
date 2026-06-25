"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useCapabilities, useSendCalls, useCallsStatus, useSendTransaction } from "wagmi";
import type { DevelopResponse, DevelopCandidate, DevelopRace } from "@/lib/api/types";
import { ConnectBar } from "@/components/racefinder/EntryControls";
import { shortAddress } from "@/lib/format";
import {
  ABSTRACT_CHAIN_ID,
  PETRACING_CONTRACT,
  JOIN_RACE_SELECTOR,
  DEVELOP_MAX_BATCH,
  buildFreeJoinCall,
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
type Phase = "select" | "review" | "submitting" | "tracking" | "done" | "error";
type Result = { petId: number; raceId: number; ok: boolean; hash?: string };

const REVEAL_STATS = ["start", "speed", "stamina", "finish"] as const;

function pctLabel(p: number): string {
  return `${Math.round((p ?? 0) * 100)}% revealed`;
}

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

export default function DevelopBoard({ initialWallet }: { initialWallet: string }) {
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

  const wallet = isConnected && address ? address : initialWallet;

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
  const available = candidates.filter((c) => c.status === "available");
  const byId = new Map(candidates.map((c) => [c.petId, c]));

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
      else if (next.size < DEVELOP_MAX_BATCH) next.add(petId);
      return next;
    });
  }

  // Manual horse-ID add: validate ownership + eligibility against the wallet's own
  // candidate set (which is exactly its hatched horses) before adding to the batch.
  // Returns an error message or null. The per-call simulation in review() is the final
  // guard, so a horse that slips through still cannot enter a doomed batch.
  const addById = useCallback((petId: number): string | null => {
    const c = candidates.find((x) => x.petId === petId);
    if (!c) return `You do not own #${petId}, or it is not race-ready.`;
    if (c.status !== "available") return `#${petId} is ${c.status === "racing" ? "racing now" : "resting (daily limit)"}.`;
    if (selected.has(petId)) return `#${petId} is already selected.`;
    if (selected.size >= DEVELOP_MAX_BATCH) return `You can select at most ${DEVELOP_MAX_BATCH}.`;
    setSelected((prev) => new Set(prev).add(petId));
    return null;
  }, [candidates, selected]);

  // Assign selected -> free slots, then SIMULATE every call at value 0. Only calls
  // that simulate green enter the batch; reverting ones are dropped and surfaced, so
  // an all-or-nothing batch can never be submitted with a doomed call inside it.
  const review = useCallback(async () => {
    setNote("");
    const order = available.filter((c) => selected.has(c.petId)).map((c) => c.petId);
    if (order.length === 0) return;
    const { placed, unplaced } = assignToSlots(order, freeRaces);
    if (!publicClient) { setError("Wallet client unavailable, reconnect."); return; }

    const sims = await Promise.all(
      placed.map(async (p) => {
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
  }, [available, selected, freeRaces, publicClient, address]);

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
    setNote("");
    setError(null);
    setPhase("select");
    load();
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

      {/* SELECT */}
      {phase === "select" && (
        <>
          {candidates.length === 0 ? (
            <div className="panel p-8 text-center">
              <p className="type-card-title text-ink">No horses found for this wallet</p>
              <p className="type-body mt-1 text-ink-soft">If you just received one, ownership can take a moment to index.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {candidates.map((c) => (
                <DevelopRow
                  key={c.petId}
                  c={c}
                  selected={selected.has(c.petId)}
                  disabled={c.status !== "available" || (!selected.has(c.petId) && selected.size >= DEVELOP_MAX_BATCH)}
                  assignedRace={selected.has(c.petId) ? raceForPet.get(c.petId) ?? null : undefined}
                  noSlot={selected.has(c.petId) && unplacedSet.has(c.petId)}
                  onToggle={() => toggle(c.petId)}
                />
              ))}
            </div>
          )}

          {/* Manual horse-ID add, alongside the ranked picker. */}
          {candidates.length > 0 && <DevelopManualAdd onAdd={addById} />}

          {/* Action bar */}
          <div className="sticky bottom-3 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}>
            <span className="type-data text-ink-soft">
              {selected.size} selected{selected.size >= DEVELOP_MAX_BATCH ? ` (max ${DEVELOP_MAX_BATCH})` : ""}, {data?.openFreeSlots ?? 0} free {(data?.openFreeSlots ?? 0) === 1 ? "slot" : "slots"} open
              {unplacedSet.size > 0 ? <span style={{ color: "var(--gold)" }}>, {unplacedSet.size} cannot be placed</span> : ""}
            </span>
            <button
              onClick={review}
              disabled={selected.size === 0 || freeRaces.length === 0}
              className="type-data rounded-md px-5 py-2.5 disabled:opacity-40"
              style={{ background: "var(--action)", color: "#14110f" }}
            >
              Review batch
            </button>
          </div>
        </>
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

function DevelopRow({ c, selected, disabled, assignedRace, noSlot, onToggle }: { c: DevelopCandidate; selected: boolean; disabled: boolean; assignedRace?: number | null; noSlot?: boolean; onToggle: () => void }) {
  const statusLabel = c.status === "available" ? null : c.status === "racing" ? "racing now" : "resting (daily limit)";
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
            {pctLabel(c.revealPct)}, {REVEAL_STATS.map((s) => `${s} ${c.reveals[s]}`).join(", ")}, {c.racesRun} races run
          </p>
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
