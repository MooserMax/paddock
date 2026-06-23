"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect, usePublicClient, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { useLoginWithAbstract } from "@abstract-foundation/agw-react";
import type { LobbyRow, LobbyResponse } from "@/lib/api/types";
import { shortAddress, formatEth } from "@/lib/format";
import { setWalletFlag } from "@/lib/walletFlag";
import { buildJoinTx, assertKnownGoodJoinTx, isFreeEntry, PETRACING_CONTRACT, JOIN_RACE_SELECTOR } from "@/lib/entry/joinRace";

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
  const { disconnect } = useDisconnect();
  const injected = connectors.find((c) => c.type === "injected");

  // Mirror connection state to the lightweight flag the global nav reads, so the
  // Stable nav item can appear without loading the wallet provider on every page.
  useEffect(() => {
    setWalletFlag(isConnected && address ? address : null);
  }, [isConnected, address]);

  if (isConnected && address) {
    return (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}>
        <span className="type-data text-ink-soft">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--green)" }} aria-hidden />
          Wallet connected, {shortAddress(address)}, showing your edge
        </span>
        <span className="flex items-center gap-3">
          <Link href="/stable" className="type-micro uppercase tracking-wider transition-paddock hover:text-glow" style={{ color: "var(--glow)" }}>Your stable</Link>
          <button onClick={() => disconnect()} className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">Disconnect</button>
        </span>
      </div>
    );
  }
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

type Phase = "review" | "validating" | "blocked" | "signing" | "pending" | "confirmed" | "rejected" | "failed";

function bandColor(): string { return "var(--glow)"; }

// The confirm-before-sign modal: shows exactly what will be signed, re-validates and
// SIMULATES immediately before the wallet prompt, and only prompts if the simulation
// succeeds. Honest banded odds, never a guaranteed win.
export function EntryModal({ lobby, walletAddress, onClose, onEntered }: { lobby: LobbyRow; walletAddress: string; onClose: () => void; onEntered: () => void }) {
  const edge = lobby.edge!;
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const [phase, setPhase] = useState<Phase>("review");
  const [reason, setReason] = useState<string>("");
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const { isSuccess: confirmed, isError: confirmFailed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (confirmed && phase === "pending") { setPhase("confirmed"); onEntered(); }
    else if (confirmFailed && phase === "pending") setPhase("failed");
  }, [confirmed, confirmFailed, phase, onEntered]);

  const fee = Number(lobby.entryFeeWei || "0");
  const pool = Number(lobby.poolWei ?? "0");
  const evEth = edge.evWei != null ? Number(edge.evWei) / 1e18 : null;
  const payout = lobby.payoutBps.map((b) => `${(b / 100).toFixed(0)}%`).join(" / ");

  const enter = useCallback(async () => {
    setReason("");
    try {
      // (a) Re-validate the live race state immediately before signing.
      setPhase("validating");
      const res = await fetch(`/api/v1/lobbies?wallet=${walletAddress}`, { cache: "no-store" });
      const data = res.ok ? ((await res.json()) as LobbyResponse) : null;
      const fresh = data?.lobbies.find((l) => l.raceId === lobby.raceId);
      if (!fresh || fresh.openSlots <= 0) { setReason("This race just filled or closed. Pick another lobby."); setPhase("blocked"); return; }
      if (!fresh.edge || fresh.edge.petId !== edge.petId) { setReason("Your recommended horse changed for this field. Reopen to see the new pick."); setPhase("blocked"); return; }
      if (fresh.entrants.some((e) => e.petId === edge.petId)) { setReason("This horse is already entered in this race."); setPhase("blocked"); return; }

      // (b)+(c) Build the exact tx, verify it matches the known-good shape, then
      // SIMULATE it from the connected account. A revert here means a precondition
      // failed (ownership, idle, slot, cooldown, any rule), so we block before the
      // wallet prompt and never submit a doomed transaction.
      const tx = buildJoinTx(lobby.raceId, edge.petId, lobby.entryFeeWei);
      assertKnownGoodJoinTx(tx, lobby.raceId, edge.petId);
      if (!publicClient) { setReason("Wallet client unavailable, reconnect and retry."); setPhase("blocked"); return; }
      try {
        await publicClient.estimateGas({ account: walletAddress as `0x${string}`, to: tx.to, data: tx.data, value: tx.value });
      } catch {
        setReason("This horse cannot enter right now. The race may have just filled, or the horse is not eligible.");
        setPhase("blocked");
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
  }, [publicClient, sendTransactionAsync, lobby, edge, walletAddress]);

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
          <Row k="Your edge" v={edge.band} accent />
        </dl>

        <p className="type-micro mt-2 normal-case text-ink-faint">
          {edge.band}, {edge.bandRange}{evEth != null ? `, EV est ${formatEth(evEth, 4)}` : ""}. This is an estimate, not yet calibrated at these odds, and the field shifts as horses enter. Never a guaranteed win.
        </p>

        {/* Exactly what gets signed */}
        <p className="type-micro mt-2 normal-case text-ink-faint">
          You will sign one transaction to {shortAddress(PETRACING_CONTRACT)} (PetRacingSystem), method join ({JOIN_RACE_SELECTOR}), with your horse and this race, value {fee > 0 ? "the entry fee" : "0"}. Paddock never holds your keys or funds.
        </p>

        {phase === "blocked" && <p className="type-data mt-3" style={{ color: "var(--gold)" }}>{reason}</p>}
        {phase === "rejected" && <p className="type-data mt-3 text-ink-soft">{reason}</p>}
        {phase === "failed" && <p className="type-data mt-3" style={{ color: "var(--brick)" }}>{reason}</p>}
        {phase === "pending" && <p className="type-data mt-3 text-ink-soft">Transaction sent, waiting for confirmation. Your entrant appears on the next lobby refresh.</p>}
        {phase === "confirmed" && <p className="type-data mt-3" style={{ color: "var(--green)" }}>Entered. {edge.petName ?? `#${edge.petId}`} is in race #{lobby.raceId}.</p>}

        <div className="mt-4 flex gap-2">
          {(phase === "review" || phase === "blocked" || phase === "rejected" || phase === "failed") && (
            <button onClick={enter} className="type-data flex-1 rounded-md px-4 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
              {phase === "review" ? "Enter in one signature" : "Try again"}
            </button>
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
export function EntryButton({ lobby, walletAddress, onEntered }: { lobby: LobbyRow; walletAddress: string; onEntered: () => void }) {
  const [open, setOpen] = useState(false);
  if (!lobby.edge) return null;
  if (!isFreeEntry(lobby.entryFeeWei)) {
    return <span className="type-micro uppercase tracking-wider text-ink-faint">paid entry coming soon</span>;
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="type-data rounded-md px-4 py-2" style={{ background: "var(--action)", color: "#14110f" }}>
        Enter with {lobby.edge.petName ?? `#${lobby.edge.petId}`}
      </button>
      {open && <EntryModal lobby={lobby} walletAddress={walletAddress} onClose={() => setOpen(false)} onEntered={() => { setOpen(false); onEntered(); }} />}
    </>
  );
}
