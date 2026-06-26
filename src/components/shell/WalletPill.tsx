"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useLoginWithAbstract } from "@abstract-foundation/agw-react";
import { shortAddress } from "@/lib/format";
import { setWalletFlag } from "@/lib/walletFlag";

// The single, app-wide wallet affordance: a compact pill in the nav top-right, in the
// same slot on every page. Connected, it shows a status dot + truncated address and
// opens a small menu with Your stable and Disconnect; disconnected, it offers Connect.
// Lives inside the app-wide wallet provider (root layout), so one connection drives the
// pill and every page board. Connect/disconnect logic is unchanged from the old in-content
// bar; this is placement, presentation, and copy only.
export default function WalletPill() {
  const { address, isConnected } = useAccount();
  const { login } = useLoginWithAbstract();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injected = connectors.find((c) => c.type === "injected");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Gate dynamic content on mount so the first paint is deterministic (no hydration
  // mismatch); wagmi reconnects from storage right after.
  useEffect(() => setMounted(true), []);
  // Mirror connection to the lightweight flag the rest of the nav reads.
  useEffect(() => { setWalletFlag(isConnected && address ? address : null); }, [isConnected, address]);
  // Dismiss the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const connected = mounted && isConnected && !!address;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={connected ? `Wallet ${shortAddress(address!)}, open wallet menu` : "Connect wallet"}
        className="transition-paddock inline-flex h-9 items-center gap-1.5 rounded-md border hairline px-2.5 text-ink-soft hover:text-ink hover:border-line-strong"
      >
        {connected ? (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--green)" }} aria-hidden />
            <span className="type-micro normal-case tabular-nums">{shortAddress(address!)}</span>
          </>
        ) : (
          <span className="type-micro uppercase tracking-wider">Connect</span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1.5 w-44 rounded-md border py-1" style={{ background: "var(--paper-raised)", borderColor: "var(--line-strong)" }}>
          {connected ? (
            <>
              <Link href="/stable" role="menuitem" onClick={() => setOpen(false)} className="type-micro block px-3 py-2 uppercase tracking-wider text-ink-soft transition-paddock hover:text-glow">Your stable</Link>
              <button type="button" role="menuitem" onClick={() => { disconnect(); setOpen(false); }} className="type-micro block w-full px-3 py-2 text-left uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">Disconnect</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { login(); setOpen(false); }} className="type-micro block w-full px-3 py-2 text-left uppercase tracking-wider text-ink transition-paddock hover:text-glow">Abstract Wallet</button>
              {injected && (
                <button type="button" role="menuitem" disabled={isPending} onClick={() => { connect({ connector: injected }); setOpen(false); }} className="type-micro block w-full px-3 py-2 text-left uppercase tracking-wider text-ink-soft transition-paddock hover:text-glow disabled:opacity-50">Browser wallet</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
