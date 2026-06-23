"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import type { LobbyResponse, LobbyRow } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import { formatEth, formatInt } from "@/lib/format";
import { ConnectBar, EntryButton } from "./EntryControls";

// The live, ranked decision board. Polls /api/v1/lobbies on the polite interval
// (the server cache fans one upstream poll out to all viewers), updates in place
// keyed by raceId so the list never reflows on refresh, and ranks by the user's
// win edge when a wallet is given. Read-only: a wallet ADDRESS personalizes the
// edge, no signature, no connection.
const TEMP_COLOR: Record<string, string> = { hot: "var(--glow)", cold: "var(--cyan)", average: "var(--ink-faint)" };

function ConditionPill({ temp }: { temp: string | null }) {
  if (!temp) return <span className="type-micro uppercase text-ink-faint">conditions at start</span>;
  const c = TEMP_COLOR[temp] ?? "var(--ink-faint)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5" style={{ borderColor: c }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} aria-hidden />
      <span className="type-micro uppercase tracking-wider" style={{ color: c }}>{temp}</span>
    </span>
  );
}

function secondsAgo(iso: string | null): string {
  if (!iso) return "waiting";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 2 ? "just now" : `${s}s ago`;
}

export default function RaceFinderBoard({ initialWallet }: { initialWallet: string }) {
  const { address, isConnected } = useAccount();
  const [wallet, setWallet] = useState(initialWallet);
  const [input, setInput] = useState(initialWallet);
  const [data, setData] = useState<LobbyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // re-render the "Xs ago" label
  // When a wallet is connected, its address drives the edge, so the recommended
  // horse is one this account actually owns. Otherwise a manually pasted address
  // gives read-only edge with no connection.
  const effectiveWallet = isConnected && address ? address : wallet;
  const walletRef = useRef(effectiveWallet);
  walletRef.current = effectiveWallet;

  const load = useCallback(async () => {
    try {
      const w = walletRef.current;
      const res = await fetch(`/api/v1/lobbies${w ? `?wallet=${w}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as LobbyResponse);
      setError(null);
    } catch {
      setError("Live data is delayed, retrying.");
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 4000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  // Reload immediately when the connected address changes so the edge follows the wallet.
  useEffect(() => { load(); }, [address, isConnected, load]);

  function submitWallet(e: React.FormEvent) {
    e.preventDefault();
    const v = input.trim();
    setWallet(/^0x[0-9a-fA-F]{40}$/.test(v) ? v : "");
    setTimeout(load, 0);
  }

  const lobbies = data?.lobbies ?? [];
  const personalized = data?.personalized ?? false;
  const connectedAddress = isConnected && address ? address : null;

  return (
    <div>
      {/* Connect for one-click entry (AGW primary, injected fallback). */}
      <ConnectBar />

      {/* Read-only edge by address, only when no wallet is connected. */}
      {!connectedAddress && (
        <form onSubmit={submitWallet} className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode="text"
            spellCheck={false}
            placeholder="Paste your wallet address for your win edge"
            aria-label="Your wallet address"
            className="type-data flex-1 rounded-md border bg-transparent px-3 py-2.5 text-ink outline-none transition-paddock focus-visible:border-glow"
            style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
          />
          <button type="submit" className="type-data rounded-md px-5 py-2.5" style={{ background: "var(--action)", color: "#14110f" }}>
            {personalized ? "Update edge" : "Show my edge"}
          </button>
        </form>
      )}

      {/* Freshness + honesty */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="type-micro normal-case text-ink-faint" key={tick}>
          {data ? (
            <>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full animate-pulse-soft" style={{ background: data.delayed ? "var(--gold)" : "var(--green)" }} aria-hidden />
              {data.delayed ? "Live data delayed, " : "Live, "}updated {secondsAgo(data.fetchedAt)}, refreshes every 4s
            </>
          ) : "Loading live lobbies"}
        </span>
        <span className="type-micro normal-case text-ink-faint">
          {personalized ? "Ranked by your win edge, best play first." : "Add your wallet to rank by your win edge."}
        </span>
      </div>

      {/* Board-level honesty caveat, surfaced once rather than per card. */}
      {personalized && (
        <p className="type-micro mb-4 normal-case text-ink-faint">
          Edges are Paddock model estimates shown as bands, not yet calibrated at these odds.
        </p>
      )}

      {error && lobbies.length === 0 && (
        <p className="type-micro mb-3 normal-case" style={{ color: "var(--gold)" }}>{error}</p>
      )}

      {lobbies.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">{data?.delayed ? "Live data is delayed" : "No open lobbies right now"}</p>
          <p className="type-body mt-1 text-ink-soft">
            {data?.delayed
              ? "The live feed is catching up, so rather than show a stale field we are holding off. Fresh lobbies appear here as soon as the feed recovers."
              : "Forming races come and go in seconds. This board updates live, check back in a moment."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {lobbies.map((l) => <LobbyCard key={l.raceId} lobby={l} personalized={personalized} connectedAddress={connectedAddress} onEntered={load} />)}
        </div>
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">{data?.meta.note}{" "}
        Served by <Link href="/api/v1/lobbies" className="underline transition-paddock hover:text-glow">/api/v1/lobbies</Link>.
      </p>
    </div>
  );
}

function LobbyCard({ lobby: l, personalized, connectedAddress, onEntered }: { lobby: LobbyRow; personalized: boolean; connectedAddress: string | null; onEntered: () => void }) {
  const fee = Number(l.entryFeeWei || "0");
  const evEth = l.edge?.evWei != null ? Number(l.edge.evWei) / 1e18 : null;
  return (
    <div className="panel p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/race/${l.raceId}`} className="type-card-title text-ink transition-paddock hover:text-glow">{l.trackLength}m</Link>
          <ConditionPill temp={l.raceTemp} />
          <span className="type-data text-ink-soft">{l.petCount}/{l.fieldSize}, {l.openSlots} {l.openSlots === 1 ? "spot" : "spots"} open</span>
          <span className="type-micro uppercase text-ink-faint">{fee > 0 ? `${formatEth(fee / 1e18, 4)} entry` : "free race"}</span>
        </div>

        {/* Your edge, the headline differentiator. An honest band, never a
            false-precise percent, with the uncalibrated qualifier alongside it. */}
        {personalized && l.edge && (
          <div className="text-right">
            <p className="type-card-title" style={{ color: "var(--glow)" }}>{l.edge.band}</p>
            <p className="type-micro normal-case text-ink-faint">
              with{" "}
              <Link href={`/pet/${l.edge.petId}`} className="transition-paddock hover:text-glow">{l.edge.petName ?? `#${l.edge.petId}`}</Link>
              {", "}{l.edge.bandRange}
              {evEth != null ? `, EV est ${formatEth(evEth, 4)}` : ""}
            </p>
          </div>
        )}
        {personalized && !l.edge && (
          <span className="type-micro uppercase text-ink-faint">no eligible horse</span>
        )}
      </div>

      {/* The current field */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {l.entrants.map((e) => (
          <span key={e.petId} className="inline-flex items-center gap-1.5">
            <Link href={`/pet/${e.petId}`} className="type-data text-ink-soft transition-paddock hover:text-glow">{e.name ?? `#${e.petId}`}</Link>
            {e.known && <RarityBadge rarity={e.rarity} size="sm" />}
            {e.isShark && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>shark</span>}
            {e.juiced && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--gold)" }}>juiced</span>}
            {!e.known && <span className="type-micro uppercase text-ink-faint">unscored</span>}
          </span>
        ))}
        {Array.from({ length: l.openSlots }).map((_, i) => (
          <span key={`open-${i}`} className="type-micro uppercase tracking-wider text-ink-faint">open</span>
        ))}
      </div>

      <p className="type-micro mt-2 normal-case text-ink-faint">
        Field strength: {l.fieldStrength.sharkCount} shark{l.fieldStrength.sharkCount === 1 ? "" : "s"}, avg ELO {l.fieldStrength.avgElo ?? "unknown"}, top quality {formatInt(l.fieldStrength.topCq)}.
        {personalized && l.edge ? " This race is forming, so your odds shift as horses enter." : ""}
      </p>

      {/* One-click entry: the algo's pick for this race, signed by the user's own
          wallet. Only when connected and this lobby has a recommended horse. */}
      {connectedAddress && l.edge && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <EntryButton lobby={l} walletAddress={connectedAddress} onEntered={onEntered} />
          <span className="type-micro normal-case text-ink-faint">Paddock recommends {l.edge.petName ?? `#${l.edge.petId}`} here, {l.edge.band.toLowerCase()} in this field.</span>
        </div>
      )}
    </div>
  );
}
