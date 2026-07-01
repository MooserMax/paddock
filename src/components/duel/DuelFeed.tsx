"use client";

import { useState } from "react";
import Link from "next/link";
import { rarityDisplay } from "@/lib/display";

// Part 5: the resolved-duel set turned into a teaching surface. Every row is a real breeding
// on-chain, tagged with what it teaches (HELD / CLIMBED / SLIPPED vs the lower parent, FORCED,
// PAID). Three aggregate callouts summarise the full set; filter chips let a user isolate the rare
// rarity-up breedings. All from the Part 1 training set, no new pipeline. Read-only.

interface Parent { petId: number; rarity: number | null; sex: string | null; topTrait: string | null }
interface Row {
  listingId: number;
  host: Parent; challenger: Parent;
  offspring: { petId: number; rarity: number | null; sex: string | null; generation: number | null };
  loserPetId: number | null; survivorPetId: number | null;
  forcedFinalDuel: boolean; priceWei: string; aggressionBps: number;
  lowerParentRarity: number | null;
}
interface Aggregates {
  rarity: { hold: number; climb: number; slip: number; n: number };
  paid: { count: number; totalWei: string; avgWei: string };
  forced: { count: number };
}
export interface DuelTrainingData { n: number; rows: Row[]; aggregates: Aggregates }

type Filter = "all" | "climbs" | "paid" | "forced" | "relic";
const RELIC = 5; // rarity index at/above which a parent counts as "Relic+"

const rarityName = (r: number | null) => (r == null ? "?" : rarityDisplay(r).name);
const sexInitial = (s: string | null) => (s ? s[0].toUpperCase() : "?");
const isPaid = (wei: string) => { try { return BigInt(wei || "0") > 0n; } catch { return false; } };

function Chip({ label, tone, muted }: { label: string; tone?: string; muted?: boolean }) {
  return (
    <span
      className="type-micro rounded px-1.5 py-0.5 uppercase tracking-wider"
      style={{ color: tone ?? "var(--ink-faint)", border: `1px solid ${muted ? "var(--line)" : tone ?? "var(--line)"}` }}
    >
      {label}
    </span>
  );
}

function ParentSpan({ p, fell }: { p: Parent; fell: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <Link href={`/pet/${p.petId}`} className="transition-paddock text-ink hover:text-glow">#{p.petId}</Link>{" "}
      <span className="text-ink-soft">{rarityName(p.rarity)}{p.topTrait ? ` ${p.topTrait}` : ""} ({sexInitial(p.sex)})</span>{" "}
      <span className="type-micro uppercase tracking-wider" style={{ color: fell ? "var(--brick)" : "var(--ink-faint)" }}>{fell ? "fell" : "survived"}</span>
    </span>
  );
}

export default function DuelFeed({ training }: { training: DuelTrainingData }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { rows, aggregates: agg, n } = training;
  if (!rows || rows.length === 0) {
    return <p className="type-data text-ink-faint">No resolved duels in the training set yet.</p>;
  }

  const avgEth = Number(agg.paid.avgWei || "0") / 1e18;
  const callouts: { text: React.ReactNode }[] = [];
  if (agg.rarity.n > 0) callouts.push({ text: <>Offspring rarity <strong className="text-ink">held</strong> at the lower parent in <strong className="text-ink">{agg.rarity.hold}</strong> of {agg.rarity.n} duels; <span style={{ color: "var(--gold)" }}>climbed in {agg.rarity.climb}</span>; slipped in {agg.rarity.slip}.</> });
  if (agg.paid.count > 0) callouts.push({ text: <><strong className="text-ink">{agg.paid.count}</strong> of {n} were paid Challenger&apos;s Duels, averaging <strong className="text-ink">{avgEth.toFixed(4)} ETH</strong>; the rest were free same-owner breeds.</> });
  if (agg.forced.count > 0) callouts.push({ text: <><strong className="text-ink">{agg.forced.count}</strong> of {n} were forced final duels, where the parent had no choice but to fall.</> });

  const passes = (r: Row): boolean => {
    if (filter === "climbs") return r.lowerParentRarity != null && r.offspring.rarity != null && r.offspring.rarity > r.lowerParentRarity;
    if (filter === "paid") return isPaid(r.priceWei);
    if (filter === "forced") return r.forcedFinalDuel;
    if (filter === "relic") return (r.host.rarity ?? 0) >= RELIC || (r.challenger.rarity ?? 0) >= RELIC;
    return true;
  };
  const shown = rows.filter(passes);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "climbs", label: "Climbs only" },
    { key: "paid", label: "Paid only" },
    { key: "forced", label: "Forced only" },
    { key: "relic", label: "Relic+" },
  ];

  return (
    <div>
      {/* Aggregate insight callouts over the FULL resolved set. */}
      {callouts.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {callouts.map((c, i) => (
            <div key={i} className="rounded-lg border hairline p-3" style={{ background: "var(--paper-raised)" }}>
              <p className="type-data text-ink-soft">{c.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter chips: client-side over the loaded set. Climbs-only surfaces the rarity-ups. */}
      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className="transition-paddock rounded-full border px-3 py-1 type-micro uppercase tracking-wider"
            style={{ borderColor: filter === f.key ? "var(--gold)" : "var(--line)", color: filter === f.key ? "var(--gold)" : "var(--ink-faint)", background: filter === f.key ? "color-mix(in srgb, var(--gold) 8%, transparent)" : "transparent" }}
          >
            {f.label}
          </button>
        ))}
        <span className="type-micro self-center normal-case text-ink-faint">{shown.length} of {rows.length} shown</span>
      </div>

      <div className="overflow-hidden rounded-lg border hairline">
        {shown.length === 0 ? (
          <p className="type-data p-4 text-ink-faint">No duels match this filter.</p>
        ) : (
          shown.map((r) => {
            const climbed = r.lowerParentRarity != null && r.offspring.rarity != null && r.offspring.rarity > r.lowerParentRarity;
            const slipped = r.lowerParentRarity != null && r.offspring.rarity != null && r.offspring.rarity < r.lowerParentRarity;
            const hostFell = r.loserPetId === r.host.petId;
            const climbStyle = climbed ? { background: "color-mix(in srgb, var(--gold) 7%, transparent)" } : undefined;
            return (
              <div key={r.listingId} className="flex flex-col gap-2 border-b hairline px-4 py-3 last:border-0 lg:flex-row lg:items-center lg:gap-4" style={climbStyle}>
                <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1 type-data">
                  <ParentSpan p={r.host} fell={hostFell} />
                  <span className="text-ink-faint">·</span>
                  <ParentSpan p={r.challenger} fell={!hostFell} />
                  <span className="text-ink-faint">-&gt;</span>
                  <span className="whitespace-nowrap">
                    <Link href={`/pet/${r.offspring.petId}`} className="transition-paddock" style={{ color: climbed ? "var(--gold)" : "var(--glow)" }}>Duelborn #{r.offspring.petId}</Link>{" "}
                    <span className="text-ink-soft">{rarityName(r.offspring.rarity)}, gen {r.offspring.generation ?? "?"} {sexInitial(r.offspring.sex)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {climbed && <Chip label="Climbed" tone="var(--gold)" />}
                  {slipped && <Chip label="Slipped" tone="var(--brick)" />}
                  {!climbed && !slipped && <Chip label="Held" muted />}
                  {r.forcedFinalDuel && <Chip label="Forced" tone="var(--cyan)" />}
                  {isPaid(r.priceWei) && <Chip label="Paid" tone="var(--green)" />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
