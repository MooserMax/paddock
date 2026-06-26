"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useConnect, usePublicClient, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { useLoginWithAbstract } from "@abstract-foundation/agw-react";
import type { LobbyRow, LobbyResponse, LobbyEdgeOption } from "@/lib/api/types";
import { shortAddress, formatEth } from "@/lib/format";
import { setWalletFlag } from "@/lib/walletFlag";
import { buildJoinTx, assertKnownGoodJoinTx, resolveEntryValueWei, isFreeEntry, PAID_ENTRY_ENABLED, PETRACING_CONTRACT, JOIN_RACE_SELECTOR, type EntryFeeTier } from "@/lib/entry/joinRace";

// One-click entry UI. Non-custodial: the user connects their own wallet and signs
// their own transaction; nothing here holds keys or auto-signs. The entry is the
// algo's recommended horse for this race, the differentiator over a blind join
// button. Free races only in this build; paid entry is gated behind review.

// The two-button connect model: AGW primary (what most Gigaverse players use, so
// their horses live in their AGW address), injected EOA as the fallback.
export function ConnectBar() {
  const { address, isConnected } = useAccount();
  const { login } = useLoginWithAbstract();
  const { connect, connectors, isPending } = useConnect();
  const injected = connectors.find((c) => c.type === "injected");

  // Mirror connection state to the lightweight flag the global nav reads, so the
  // Stable nav item can appear without loading the wallet provider on every page.
  useEffect(() => {
    setWalletFlag(isConnected && address ? address : null);
  }, [isConnected, address]);

  // The connected affordance now lives in the app-wide nav pill (WalletPill), so the old
  // wide in-content strip renders nothing. Disconnected, we still show the contextual
  // connect prompt below, in place.
  if (isConnected && address) return null;
  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row">
      <button onClick={() => login()} className="type-data rounded-md px-5 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
        Connect Abstract Wallet
      </button>
      {injected && (
        <button onClick={() => connect({ connector: injected })} disabled={isPending} className="type-data rounded-md border px-5 py-2.5 text-ink transition-paddock hover:border-glow disabled:opacity-50" style={{ borderColor: "var(--line-strong)" }}>
          Browser wallet
        </button>
      )}
      <span className="type-micro normal-case text-ink-faint sm:self-center">Connect to enter the recommended horse in one signature. Read-only edge needs no wallet.</span>
    </div>
  );
}

type Phase = "review" | "validating" | "blocked" | "juiceBlocked" | "signing" | "pending" | "confirmed" | "rejected" | "failed";

function bandColor(): string { return "var(--glow)"; }

// wei (bigint) -> ETH string, enough precision to show the 1% vs 3% surcharge
// distinction (e.g. 0.0002525 vs 0.0002575) without rounding it away.
function ethFromWei(wei: bigint): string {
  return formatEth(Number(wei) / 1e18, 7);
}

// The confirm-before-sign modal: shows exactly what will be signed, re-validates and
// SIMULATES immediately before the wallet prompt, and only prompts if the simulation
// succeeds. Honest banded odds, never a guaranteed win.
// pick is the horse the user selected for this lobby (the model's top pick by
// default). It drives BOTH the display and which petId is entered. Everything about
// how the entry value is computed, simulated, and signed is unchanged; only the petId
// differs from the old single-pick behavior.
export function EntryModal({ lobby, pick, walletAddress, onClose, onEntered }: { lobby: LobbyRow; pick: LobbyEdgeOption; walletAddress: string; onClose: () => void; onEntered: (petId: number) => void }) {
  const edge = pick;
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const [phase, setPhase] = useState<Phase>("review");
  const [reason, setReason] = useState<string>("");
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const { isSuccess: confirmed, isError: confirmFailed } = useWaitForTransactionReceipt({ hash });

  // Paid entry. Juiced defaults ON: it is the better deal (1% protocol fee + 2x
  // jackpot odds vs 3%), and most entrants are juiced. The toggle selects which tier
  // Paddock ATTEMPTS; the horse's real juiced state is pre-committed on-chain, so the
  // mandatory pre-sign simulation is what confirms the value matches before signing,
  // and a juiced-tier revert falls to an explicit "enter standard?" choice below.
  const paid = !isFreeEntry(lobby.entryFeeWei);
  const [juiced, setJuiced] = useState(true);
  const tierFor = useCallback(
    (j: boolean): EntryFeeTier => ({ protocolFeeBps: lobby.protocolFeeBps, protocolFeeBpsJuiced: lobby.protocolFeeBpsJuiced, juiced: j }),
    [lobby.protocolFeeBps, lobby.protocolFeeBpsJuiced]
  );
  // Live total for the current toggle state, recomputed each render so the displayed
  // value always matches what will be signed. Null if it cannot be computed (paid
  // disabled, or fee config not loaded yet).
  let sendValue: bigint | null = null;
  try {
    sendValue = resolveEntryValueWei(lobby.entryFeeWei, paid ? tierFor(juiced) : undefined);
  } catch {
    sendValue = null;
  }
  const baseFeeWei = paid ? BigInt(lobby.entryFeeWei || "0") : 0n;
  const surchargeWei = sendValue != null ? sendValue - baseFeeWei : null;
  const ratePct = juiced ? "1%" : "3%";

  useEffect(() => {
    if (confirmed && phase === "pending") { setPhase("confirmed"); onEntered(edge.petId); }
    else if (confirmFailed && phase === "pending") setPhase("failed");
  }, [confirmed, confirmFailed, phase, onEntered, edge.petId]);

  const fee = Number(lobby.entryFeeWei || "0");
  const pool = Number(lobby.poolWei ?? "0");
  const evEth = edge.evWei != null ? Number(edge.evWei) / 1e18 : null;
  const payout = lobby.payoutBps.map((b) => `${(b / 100).toFixed(0)}%`).join(" / ");

  // juicedOverride lets the "enter standard instead" path retry at the non-juiced tier
  // immediately, without waiting for the toggle's state update to settle.
  const enter = useCallback(async (juicedOverride?: boolean) => {
    const useJuiced = juicedOverride ?? juiced;
    setReason("");
    try {
      // (a) Re-validate the live race state immediately before signing.
      setPhase("validating");
      const res = await fetch(`/api/v1/lobbies?wallet=${walletAddress}`, { cache: "no-store" });
      const data = res.ok ? ((await res.json()) as LobbyResponse) : null;
      const fresh = data?.lobbies.find((l) => l.raceId === lobby.raceId);
      if (!fresh || fresh.openSlots <= 0) { setReason("This race just filled or closed. Pick another lobby."); setPhase("blocked"); return; }
      if (fresh.entrants.some((e) => e.petId === edge.petId)) { setReason("This horse is already entered in this race."); setPhase("blocked"); return; }
      // Note: eligibility of the EXACT selected horse (picked OR manually entered) is
      // verified authoritatively by the simulation gate below, so we do not gate on the
      // model's top-5 options here, which would wrongly block a valid manual override.

      // (b) Compute the EXACT value for the tier being attempted from the LIVE bps,
      // then build the tx and verify it matches the known-good shape AND that value.
      // Paid is gated: resolveEntryValueWei throws while PAID_ENTRY_ENABLED is false,
      // so no paid value can be built in production.
      const tier = paid ? tierFor(useJuiced) : undefined;
      let expectedValue: bigint;
      try {
        expectedValue = resolveEntryValueWei(lobby.entryFeeWei, tier);
      } catch {
        setReason("Paid entry is not available yet."); setPhase("blocked"); return;
      }
      const tx = buildJoinTx(lobby.raceId, edge.petId, lobby.entryFeeWei, tier);
      assertKnownGoodJoinTx(tx, lobby.raceId, edge.petId, expectedValue);
      if (!publicClient) { setReason("Wallet client unavailable, reconnect and retry."); setPhase("blocked"); return; }

      // (c) MANDATORY simulation at the EXACT value, before the wallet ever prompts.
      // The contract requires the exact tier value, so a juiced entry whose horse is
      // not actually juiced (or any other unmet precondition) reverts HERE and is
      // never signed, no funds at risk. A juiced-tier revert is surfaced as an
      // explicit "enter standard instead?" choice rather than silently re-pricing 3x.
      try {
        await publicClient.estimateGas({ account: walletAddress as `0x${string}`, to: tx.to, data: tx.data, value: tx.value });
      } catch {
        if (paid && useJuiced) {
          setReason("The juiced entry (1% fee plus 2x jackpot odds) did not go through for this horse right now. You can enter as a standard race (3% fee) instead, or cancel.");
          setPhase("juiceBlocked");
        } else {
          setReason("This horse cannot enter right now. The race may have just filled, or the horse is not eligible.");
          setPhase("blocked");
        }
        return;
      }

      // Sign. The user's own wallet displays and approves the transaction.
      setPhase("signing");
      const sent = await sendTransactionAsync({ to: tx.to, data: tx.data, value: tx.value });
      setHash(sent);
      setPhase("pending");
    } catch (e: unknown) {
      const m = (e as { message?: string })?.message ?? "";
      if (/reject|denied|User rejected/i.test(m)) { setReason("You rejected the transaction."); setPhase("rejected"); }
      else if (/insufficient funds/i.test(m)) { setReason("Insufficient funds for gas."); setPhase("failed"); }
      else { setReason(m.slice(0, 140) || "The transaction failed."); setPhase("failed"); }
    }
  }, [publicClient, sendTransactionAsync, lobby, edge, walletAddress, paid, juiced, tierFor]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="panel w-full max-w-md p-5 sm:rounded-lg" style={{ background: "var(--paper)" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="eyebrow">Paddock recommends</p>
            <h2 className="type-card-title text-ink">Enter with {edge.petName ?? `#${edge.petId}`}</h2>
          </div>
          <button onClick={onClose} className="type-micro uppercase text-ink-faint hover:text-ink">Close</button>
        </div>

        {/* What will be signed, in full, before any wallet prompt */}
        <dl className="space-y-1.5 rounded-md border p-3" style={{ borderColor: "var(--line-strong)" }}>
          <Row k="Horse" v={`#${edge.petId}`} />
          <Row k="Race" v={`#${lobby.raceId}, ${lobby.trackLength}m, ${lobby.petCount}/${lobby.fieldSize} in${lobby.raceTemp ? `, ${lobby.raceTemp}` : ", conditions at start"}`} />
          <Row k="Entry fee" v={fee > 0 ? `${formatEth(fee / 1e18, 4)}` : "free"} />
          <Row k="Pool" v={pool > 0 ? `${formatEth(pool / 1e18, 4)}` : "none yet"} />
          <Row k="Payout split" v={payout || "winner takes all"} />
          {/* Paid only: the protocol surcharge for the chosen tier, and the exact
              total the wallet sends. Jackpot and creator fees come out of the pool,
              not the wallet charge, so they are not added here. */}
          {paid && <Row k={`Protocol fee (${ratePct})`} v={surchargeWei != null ? ethFromWei(surchargeWei) : "unknown"} />}
          {paid && <Row k="You send" v={sendValue != null ? ethFromWei(sendValue) : "unavailable"} accent />}
          <Row k="Your edge" v={edge.band} accent />
        </dl>

        {/* Paid only: juice toggle, default ON. Selects the tier Paddock attempts; the
            chain confirms via the pre-sign simulation before anything is signed. */}
        {paid && (
          <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--line-strong)" }}>
            <div className="flex items-center justify-between gap-3">
              <span className="type-data text-ink">Juice this entry</span>
              <button
                type="button"
                role="switch"
                aria-checked={juiced}
                onClick={() => setJuiced((j) => !j)}
                disabled={phase === "validating" || phase === "signing"}
                className="type-micro uppercase tracking-wider rounded-full border px-3 py-1 transition-paddock disabled:opacity-50"
                style={{ borderColor: juiced ? "var(--glow)" : "var(--line-strong)", color: juiced ? "var(--glow)" : "var(--ink-faint)" }}
              >
                {juiced ? "On" : "Off"}
              </button>
            </div>
            <p className="type-micro mt-1.5 normal-case text-ink-faint">
              Juiced: {lobby.protocolFeeBpsJuiced != null ? `${(lobby.protocolFeeBpsJuiced / 100).toFixed(0)}%` : "1%"} protocol fee and 2x jackpot odds. Standard: {lobby.protocolFeeBps != null ? `${(lobby.protocolFeeBps / 100).toFixed(0)}%` : "3%"} protocol fee. Jackpot and creator fees are paid from the pool, not added to your charge.
            </p>
          </div>
        )}

        <p className="type-micro mt-2 normal-case text-ink-faint">
          {edge.band}, {edge.bandRange}{evEth != null ? `, EV est ${formatEth(evEth, 4)}` : ""}. This is an estimate, not yet calibrated at these odds, and the field shifts as horses enter. Never a guaranteed win.
        </p>

        {/* Exactly what gets signed */}
        <p className="type-micro mt-2 normal-case text-ink-faint">
          You will sign one transaction to {shortAddress(PETRACING_CONTRACT)} (PetRacingSystem), method join ({JOIN_RACE_SELECTOR}), with your horse and this race, value {paid ? (sendValue != null ? ethFromWei(sendValue) : "the entry fee plus protocol fee") : "0"}. Paddock never holds your keys or funds.
        </p>

        {phase === "blocked" && <p className="type-data mt-3" style={{ color: "var(--gold)" }}>{reason}</p>}
        {phase === "juiceBlocked" && <p className="type-data mt-3" style={{ color: "var(--gold)" }}>{reason}</p>}
        {phase === "rejected" && <p className="type-data mt-3 text-ink-soft">{reason}</p>}
        {phase === "failed" && <p className="type-data mt-3" style={{ color: "var(--brick)" }}>{reason}</p>}
        {phase === "pending" && <p className="type-data mt-3 text-ink-soft">Transaction sent, waiting for confirmation. Your entrant appears on the next lobby refresh.</p>}
        {phase === "confirmed" && <p className="type-data mt-3" style={{ color: "var(--green)" }}>Entered. {edge.petName ?? `#${edge.petId}`} is in race #{lobby.raceId}.</p>}

        <div className="mt-4 flex gap-2">
          {(phase === "review" || phase === "blocked" || phase === "rejected" || phase === "failed") && (
            <button onClick={() => enter()} className="type-data flex-1 rounded-md px-4 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
              {phase === "review" ? "Enter in one signature" : "Try again"}
            </button>
          )}
          {/* Juiced-tier revert: explicit choice, never a silent 3x re-price. Enter
              standard retries at the non-juiced tier; cancel closes. */}
          {phase === "juiceBlocked" && (
            <>
              <button onClick={() => { setJuiced(false); enter(false); }} className="type-data flex-1 rounded-md px-4 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
                Enter standard ({lobby.protocolFeeBps != null ? `${(lobby.protocolFeeBps / 100).toFixed(0)}%` : "3%"})
              </button>
              <button onClick={onClose} className="type-data flex-1 rounded-md border px-4 py-2.5 text-ink" style={{ borderColor: "var(--line-strong)" }}>Cancel</button>
            </>
          )}
          {(phase === "validating" || phase === "signing") && (
            <button disabled className="type-data flex-1 rounded-md px-4 py-2.5 opacity-70" style={{ background: "var(--action)", color: "#14110f" }}>
              {phase === "validating" ? "Checking the race is still open" : "Confirm in your wallet"}
            </button>
          )}
          {(phase === "pending" || phase === "confirmed") && (
            <button onClick={onClose} className="type-data flex-1 rounded-md border px-4 py-2.5 text-ink" style={{ borderColor: "var(--line-strong)" }}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-micro uppercase tracking-wider text-ink-faint">{k}</dt>
      <dd className="type-data text-right" style={{ color: accent ? bandColor() : "var(--ink-soft)" }}>{v}</dd>
    </div>
  );
}

// Per-lobby entry trigger. Shown only for a free race where the connected wallet has
// an eligible recommended horse. Paid races show a gated note instead.
export function EntryButton({ lobby, pick, walletAddress, onEntered }: { lobby: LobbyRow; pick: LobbyEdgeOption; walletAddress: string; onEntered: (petId: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!lobby.edge) return null;
  // Paid entry is fully built but gated behind PAID_ENTRY_ENABLED. While the flag is
  // false, paid races stay "coming soon" and no paid entry can be opened or signed.
  // Flipping that one flag to true turns this branch off and paid races get the same
  // one-signature entry as free races, no other change required.
  if (!isFreeEntry(lobby.entryFeeWei) && !PAID_ENTRY_ENABLED) {
    return <span className="type-micro uppercase tracking-wider text-ink-faint">paid entry coming soon</span>;
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="type-data rounded-md px-4 py-2" style={{ background: "var(--action)", color: "#14110f" }}>
        Enter with {pick.petName ?? `#${pick.petId}`}
      </button>
      {open && <EntryModal lobby={lobby} pick={pick} walletAddress={walletAddress} onClose={() => setOpen(false)} onEntered={(petId) => { setOpen(false); onEntered(petId); }} />}
    </>
  );
}
