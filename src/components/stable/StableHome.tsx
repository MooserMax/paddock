"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import type { WalletSummary, PetCardDTO, PetDossier, RaceHistoryItem } from "@/lib/api/types";
import PetCard from "@/components/PetCard";
import Panel from "@/components/ui/Panel";
import WalletSearch from "@/components/WalletSearch";
import { ConnectBar } from "@/components/racefinder/EntryControls";
import RaceTracker from "@/components/stable/RaceTracker";
import StableReport from "@/components/stable/StableReport";
import { formatEth, formatInt, ordinal, ownerDisplay, timeAgo, asOfLabel } from "@/lib/format";

// Logged-in stable home. With a wallet connected (AGW or injected) it loads that
// address's stable automatically, no pasting. With no wallet it falls back to the
// existing paste-an-address flow. Read-only throughout, reuses the existing pet
// card and wallet endpoint, no new data pipeline.

interface Perf extends RaceHistoryItem {
  petId: number;
  petName: string | null;
}

export default function StableHome({ initialAddress }: { initialAddress: string }) {
  const { address, isConnected } = useAccount();
  const wallet = isConnected && address ? address : initialAddress || null;

  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [perfs, setPerfs] = useState<Perf[]>([]);
  const [loading, setLoading] = useState(false);

  // Reload the stable. Re-run on mount, on a slow poll, and on tab focus, so a
  // just-resolved race's updated stats appear within a bounded window instead of
  // staying stale until a manual reload. aliveRef guards against setState after the
  // wallet changed mid-flight.
  const aliveRef = useRef(0);
  const load = useCallback(async (showSpinner: boolean) => {
    if (!wallet) { setSummary(null); setPerfs([]); return; }
    const gen = ++aliveRef.current;
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/v1/wallet/${wallet}`, { cache: "no-store" });
      const s = res.ok ? ((await res.json()) as WalletSummary) : null;
      if (gen !== aliveRef.current) return;
      setSummary(s);
      const horses = [...(s?.aTeam ?? []), ...(s?.hiddenGems ?? [])]
        .sort((a, b) => b.confirmedQuality - a.confirmedQuality)
        .slice(0, 6);
      const merged: Perf[] = [];
      await Promise.all(horses.map(async (h) => {
        try {
          const pr = await fetch(`/api/v1/pet/${h.id}`, { cache: "no-store" });
          if (!pr.ok) return;
          const dossier = (await pr.json()) as PetDossier;
          for (const rr of dossier.recentRaces ?? []) merged.push({ ...rr, petId: h.id, petName: h.name });
        } catch { /* skip this horse */ }
      }));
      if (gen !== aliveRef.current) return;
      merged.sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
      setPerfs(merged.slice(0, 12));
    } catch {
      if (gen === aliveRef.current) setSummary(null);
    } finally {
      if (gen === aliveRef.current) setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    load(true);
    const poll = setInterval(() => load(false), 60_000);
    const onFocus = () => load(false);
    window.addEventListener("focus", onFocus);
    return () => { aliveRef.current++; clearInterval(poll); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // No wallet at all: connect, or paste an address (the existing fallback).
  if (!wallet) {
    return (
      <div>
        <ConnectBar />
        <Panel eyebrow="Your stable" title="Connect to see your Giglings" className="mt-2">
          <p className="type-body text-ink-soft">Connect your wallet to load your stable automatically, no address pasting. Or view any stable by address.</p>
          <div className="mt-6 max-w-xl"><WalletSearch size="md" /></div>
        </Panel>
      </div>
    );
  }

  const horses: PetCardDTO[] = summary
    ? [...summary.aTeam, ...summary.hiddenGems].sort((a, b) => b.confirmedQuality - a.confirmedQuality)
    : [];

  return (
    <div>
      <ConnectBar />

      {loading && !summary && <p className="type-body text-ink-soft">Reading your stable.</p>}

      {summary && summary.petCount === 0 && (
        <Panel eyebrow="Your stable" title="No Giglings here yet">
          <p className="type-body text-ink-soft">This wallet holds no Giglings that Paddock tracks. If you just received one, ownership can take a moment to index.</p>
          <div className="mt-6 max-w-xl"><WalletSearch size="md" /></div>
        </Panel>
      )}

      {summary && summary.petCount > 0 && (
        <>
          {/* Header */}
          <header className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="type-section text-ink">{ownerDisplay(summary.name, summary.address)}</h2>
              <span className="type-data text-ink-faint">{formatInt(summary.petCount)} Giglings, {formatInt(summary.hatchedCount)} hatched</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {summary.stableValue.lowEth != null && summary.stableValue.highEth != null && (
                <span className="type-micro normal-case text-ink-faint">Estimated value {formatEth(summary.stableValue.lowEth, 3)} to {formatEth(summary.stableValue.highEth, 3)}</span>
              )}
              {summary.skill.score != null && (
                <span className="type-micro normal-case text-ink-faint">Stable skill {summary.skill.score.toFixed(1)}{summary.skill.rank != null ? `, rank ${summary.skill.rank} of ${summary.skill.eligibleTotal}` : ""}</span>
              )}
              <Link href={`/wallet/${summary.address}`} className="type-micro uppercase tracking-wider transition-paddock hover:text-glow" style={{ color: "var(--glow)" }}>Full report</Link>
            </div>
            {summary.asOf && (
              <span className="type-micro normal-case text-ink-faint">Stable data as of {asOfLabel(summary.asOf)}, refreshes automatically</span>
            )}
          </header>

          {/* Stable Intelligence Report: standouts, why, and one-click Develop. */}
          <StableReport summary={summary} />

          {/* Follow-your-entry tracker (Piece 3) */}
          <RaceTracker wallet={wallet} />

          {/* Your horses, ranked by the model's confirmed-quality score */}
          <section className="mt-8">
            <h2 className="type-section mb-3 text-ink">Your horses, best first</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {horses.map((p) => <PetCard key={p.id} pet={p} metric="cq" />)}
            </div>
          </section>

          {/* Recent performances, merged from your top horses */}
          <section className="mt-8">
            <h2 className="type-section mb-3 text-ink">Recent performances</h2>
            {perfs.length === 0 ? (
              <p className="type-body text-ink-soft">No finished races yet for your top horses.</p>
            ) : (
              <div className="panel divide-y" style={{ borderColor: "var(--line)" }}>
                {perfs.map((p) => (
                  <Link key={`${p.petId}-${p.raceId}`} href={`/race/${p.raceId}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 p-3 transition-paddock hover:bg-paper-raised">
                    <span className="type-data text-ink">{p.petName ?? `#${p.petId}`}</span>
                    <span className="type-data text-ink-soft">
                      {p.finishPosition != null && p.fieldSize != null ? `${ordinal(p.finishPosition)} of ${p.fieldSize}` : "raced"}
                      {p.trackLength != null ? `, ${p.trackLength}m` : ""}
                    </span>
                    <span className="type-micro normal-case text-ink-faint">
                      {p.payoutWei && Number(p.payoutWei) > 0 ? `paid ${formatEth(Number(p.payoutWei) / 1e18, 4)}, ` : ""}
                      {p.resolvedAt ? timeAgo(p.resolvedAt) : ""}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
