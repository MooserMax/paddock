"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import type { LobbyResponse, LobbyRow, LobbyEdgeOption, PetEntryCheck } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import { formatEth, formatInt, asOfLabel } from "@/lib/format";
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

  // Re-enter support: after a horse enters a race, the server's "racing" signal takes
  // a cycle to catch up, so we optimistically drop a just-entered horse from the
  // pickers right away (across all lobbies) and refresh the board. The timestamp lets
  // the optimistic drop expire after the server has caught up, so a horse that becomes
  // eligible again (its race resolved, still under the daily cap) reappears. This is
  // what keeps the flow alive: enter one, it drops out, immediately pick another.
  const [enteredAt, setEnteredAt] = useState<Map<number, number>>(new Map());
  const handleEntered = useCallback((petId: number) => {
    setEnteredAt((prev) => new Map(prev).set(petId, Date.now()));
    load();
  }, [load]);
  const recentlyEntered = new Set([...enteredAt].filter(([, t]) => Date.now() - t < 45_000).map(([id]) => id));

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
              {data.asOf ? `, results as of ${asOfLabel(data.asOf)}` : ""}
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

      {/* Eligibility: two stable states. Resting horses have used their daily race
          limit; racing horses are busy in a race now. Neither is recommended. */}
      {personalized && data?.roster?.allUnavailable && (
        <div className="panel mb-4 p-4">
          <p className="type-card-title text-ink">No horse to enter right now</p>
          <p className="type-body mt-1 text-ink-soft">
            {data.roster.racing.length > 0 && data.roster.resting.length === 0
              ? "All of your Giglings are racing right now. They are free to enter again as soon as those races finish."
              : "All of your Giglings have used their daily race limit, so there is no entry to recommend. They can race again once the daily limit resets."}
          </p>
        </div>
      )}
      {personalized && data?.roster && !data.roster.allUnavailable && (data.roster.resting.length > 0 || data.roster.racing.length > 0) && (
        <p className="type-micro mb-4 normal-case text-ink-faint">
          {data.roster.resting.length > 0 ? `Used their daily limit: ${data.roster.resting.map((p) => p.name ?? `#${p.petId}`).join(", ")}. ` : ""}
          {data.roster.racing.length > 0 ? `Racing right now, free shortly: ${data.roster.racing.map((p) => p.name ?? `#${p.petId}`).join(", ")}. ` : ""}
          Recommending from your horses that can still race.
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
          {lobbies.map((l) => <LobbyCard key={l.raceId} lobby={l} personalized={personalized} connectedAddress={connectedAddress} recentlyEntered={recentlyEntered} onEntered={handleEntered} />)}
        </div>
      )}

      <p className="type-micro mt-4 normal-case text-ink-faint">{data?.meta.note}{" "}
        Served by <Link href="/api/v1/lobbies" className="underline transition-paddock hover:text-glow">/api/v1/lobbies</Link>.
      </p>
    </div>
  );
}

function LobbyCard({ lobby: l, personalized, connectedAddress, recentlyEntered, onEntered }: { lobby: LobbyRow; personalized: boolean; connectedAddress: string | null; recentlyEntered: Set<number>; onEntered: (petId: number) => void }) {
  const fee = Number(l.entryFeeWei || "0");
  const evEth = l.edge?.evWei != null ? Number(l.edge.evWei) / 1e18 : null;

  // The user's top eligible horses for this lobby, best first. Default selection is
  // the model's top pick (options[0]), so doing nothing preserves the old behavior.
  // Selecting another horse only changes which petId enters; the entry flow is
  // unchanged. A just-entered horse is filtered out immediately (recentlyEntered) so
  // the picker advances to the next eligible horse without waiting for the server.
  const options: LobbyEdgeOption[] = (l.edge?.options ?? []).filter((o) => !recentlyEntered.has(o.petId));
  const [selectedPetId, setSelectedPetId] = useState<number | null>(options[0]?.petId ?? null);
  // A manually typed horse (validated for ownership + eligibility) becomes a selectable
  // option just like a picked one; only its petId differs into the unchanged entry path.
  const [manualOption, setManualOption] = useState<LobbyEdgeOption | null>(null);
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  useEffect(() => {
    if (manualOption && selectedPetId === manualOption.petId) return; // keep a manual selection
    if (options.length && !options.some((o) => o.petId === selectedPetId)) setSelectedPetId(options[0].petId);
  }, [options, selectedPetId, manualOption]);
  const selected =
    manualOption && manualOption.petId === selectedPetId
      ? manualOption
      : options.find((o) => o.petId === selectedPetId) ?? options[0] ?? null;
  const isTopPick = selected != null && l.edge != null && selected.petId === l.edge.petId;
  const isManual = selected != null && manualOption != null && selected.petId === manualOption.petId;

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

      {/* Entry: pick from your top eligible horses (best first), default the model's
          top pick, OR type a specific horse ID to override. Each option shows its win
          band so the tradeoff is honest, which matters most for a paid race on a
          non-top horse. Signed by the user's own wallet; only the selected petId
          changes, the entry flow (value, simulation, signing) is unchanged. */}
      {connectedAddress && (l.edge || manualOption) && (
        <div className="mt-3">
          {options.length > 1 && (
            <div className="mb-2.5">
              <p className="type-micro mb-1.5 uppercase tracking-wider text-ink-faint">Choose your horse</p>
              <div className="flex flex-wrap gap-1.5">
                {options.map((o, i) => {
                  const active = !isManual && o.petId === selected?.petId;
                  return (
                    <button
                      key={o.petId}
                      onClick={() => { setSelectedPetId(o.petId); setManualMsg(null); }}
                      aria-pressed={active}
                      className="rounded-md border px-2.5 py-1.5 text-left transition-paddock"
                      style={{ borderColor: active ? "var(--glow)" : "var(--line-strong)", background: active ? "color-mix(in srgb, var(--glow) 12%, transparent)" : "transparent" }}
                    >
                      <span className="type-data block" style={{ color: active ? "var(--glow)" : "var(--ink-soft)" }}>
                        {o.petName ?? `#${o.petId}`}{i === 0 ? " ★" : ""}
                      </span>
                      <span className="type-micro block normal-case text-ink-faint">{o.band}</span>
                    </button>
                  );
                })}
                {isManual && selected && (
                  <span className="rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--glow)", background: "color-mix(in srgb, var(--glow) 12%, transparent)" }}>
                    <span className="type-data block" style={{ color: "var(--glow)" }}>{selected.petName ?? `#${selected.petId}`} (manual)</span>
                    <span className="type-micro block normal-case text-ink-faint">{selected.band}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Manual horse-ID override, gated by ownership + eligibility before it can
              be selected; the simulation gate is still the final check at entry. */}
          <ManualHorseInput
            wallet={connectedAddress}
            raceId={l.raceId}
            onValid={(opt) => { setManualOption(opt); setSelectedPetId(opt.petId); setManualMsg(null); }}
            onInvalid={(msg) => { setManualMsg(msg); }}
          />
          {manualMsg && <p className="type-micro mt-1.5 normal-case" style={{ color: "var(--gold)" }}>{manualMsg}</p>}

          {selected && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <EntryButton lobby={l} pick={selected} walletAddress={connectedAddress} onEntered={onEntered} />
              <span className="type-micro normal-case text-ink-faint">
                {isManual
                  ? `Entering ${selected.petName ?? `#${selected.petId}`}, ${selected.band.toLowerCase()}${fee > 0 ? " in a paid race" : ""} (your manual pick).`
                  : isTopPick
                    ? `Paddock recommends ${selected.petName ?? `#${selected.petId}`} here, ${selected.band.toLowerCase()} in this field.`
                    : `Entering ${selected.petName ?? `#${selected.petId}`}, ${selected.band.toLowerCase()}${fee > 0 ? " in a paid race" : ""}.${l.edge ? ` Paddock's top pick is ${l.edge.petName ?? `#${l.edge.petId}`}.` : ""}`}
                {fee > 0 && selected.evWei != null ? ` EV est ${formatEth(Number(selected.evWei) / 1e18, 4)}.` : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Manual horse-ID override. Validates ownership + eligibility (and the horse's band in
// this race) via /api/v1/pet-eligibility before letting it be selected. The entry
// flow's own pre-sign simulation remains the final guard.
function ManualHorseInput({ wallet, raceId, onValid, onInvalid }: { wallet: string; raceId: number; onValid: (opt: LobbyEdgeOption) => void; onInvalid: (msg: string) => void }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const go = useCallback(async () => {
    const petId = Number(id);
    if (!Number.isInteger(petId) || petId <= 0) { onInvalid("Enter a numeric horse ID."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/pet-eligibility?wallet=${wallet}&pet=${petId}&race=${raceId}`, { cache: "no-store" });
      const c = (await res.json()) as PetEntryCheck;
      if (!c.owned) { onInvalid(c.reason ?? `You do not own #${petId}.`); return; }
      if (!c.eligible) { onInvalid(c.reason ?? `#${petId} cannot enter this race right now.`); return; }
      onValid({ petId: c.petId, petName: c.petName, pWin: c.pWin ?? 0, band: c.band ?? "Unscored", bandRange: c.bandRange ?? "", evWei: c.evWei });
      setId("");
    } catch {
      onInvalid("Could not validate that horse, try again.");
    } finally {
      setBusy(false);
    }
  }, [id, wallet, raceId, onValid, onInvalid]);
  return (
    <div className="flex items-center gap-2">
      <span className="type-micro uppercase tracking-wider text-ink-faint">or horse ID</span>
      <input
        value={id}
        onChange={(e) => setId(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        inputMode="numeric"
        placeholder="e.g. 4967"
        aria-label="Enter a specific horse ID"
        className="type-data w-24 rounded-md border bg-transparent px-2 py-1.5 text-ink outline-none focus-visible:border-glow"
        style={{ borderColor: "var(--line-strong)" }}
      />
      <button onClick={go} disabled={busy || !id} className="type-micro uppercase tracking-wider rounded-md border px-3 py-1.5 text-ink transition-paddock hover:border-glow disabled:opacity-40" style={{ borderColor: "var(--line-strong)" }}>
        {busy ? "checking" : "use"}
      </button>
    </div>
  );
}
