"use client";

import Link from "next/link";
import Image from "next/image";
import type { WalletSummary, PetCardDTO, RevealQueueItem } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import { formatInt, formatEth } from "@/lib/format";

// The Stable Intelligence Report: turn the racing you already do into a digestible
// read of which horses are standouts and why, and send the best straight into Develop
// in one click. Chronicle voice, confirmed facts only, every number from the verified
// wallet endpoint. It never headlines the stable-average skill rank (an average that
// buries the best horse); the lead is the standout horse itself.

function pctOfField(p: number | null): string {
  if (p == null) return "";
  const v = p * 100;
  return v < 0.1 ? `top ${v.toFixed(2)}%` : v < 10 ? `top ${v.toFixed(1)}%` : `top ${Math.round(v)}%`;
}

function RevealBar({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(1, pct));
  return (
    <span className="inline-flex items-center gap-1.5" title={`${Math.round(v * 100)}% revealed`}>
      <span className="relative inline-block h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--line-strong)" }} aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v * 100}%`, background: "var(--glow)" }} />
      </span>
      <span className="type-micro normal-case text-ink-faint">{Math.round(v * 100)}%</span>
    </span>
  );
}

function developHref(wallet: string, ids: number[], from: string): string {
  return `/develop?wallet=${wallet}&from=${encodeURIComponent(from)}&pick=${ids.join(",")}`;
}

function DevelopButton({ href, label, count }: { href: string; label: string; count: number }) {
  if (count === 0) return null;
  return (
    <Link href={href} className="type-data rounded-md px-4 py-2" style={{ background: "var(--action)", color: "#14110f" }}>
      {label} ({count})
    </Link>
  );
}

export default function StableReport({ summary }: { summary: WalletSummary }) {
  const { skill, aTeam, hiddenGems, revealQueue, stableValue } = summary;
  const wallet = summary.address;

  // The standout horse: the highest-cq proven horse (skill.topPetId), with its full
  // card pulled from aTeam. Lead with THIS, never the stable-average rank.
  const headliner: PetCardDTO | null =
    skill.topPetId != null ? aTeam.find((p) => p.id === skill.topPetId) ?? aTeam[0] ?? null : aTeam[0] ?? null;

  return (
    <section className="mt-6">
      <p className="eyebrow mb-2">Stable intelligence</p>

      {/* 1. HEADLINER: the standout horse. */}
      {headliner && skill.topPetCq != null && (
        <div className="panel p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {headliner.imgUrl && (
              <Image src={headliner.imgUrl} alt={headliner.name ?? `#${headliner.id}`} width={96} height={96} className="h-24 w-24 shrink-0 rounded-md object-cover" style={{ background: "var(--paper-raised)" }} unoptimized />
            )}
            <div className="min-w-0">
              <p className="type-micro uppercase tracking-wider text-ink-faint">Your standout</p>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/pet/${headliner.id}`} className="type-card-title text-ink transition-paddock hover:text-glow">{headliner.name ?? `#${headliner.id}`}</Link>
                <RarityBadge rarity={headliner.rarity.value} size="sm" />
                {skill.topPetPercentile != null && (
                  <span className="type-data" style={{ color: "var(--glow)" }}>{skill.topPetIsBest ? "the single best horse in the game" : `${pctOfField(skill.topPetPercentile)} of all horses`}</span>
                )}
              </div>
              <p className="type-body mt-1 text-ink-soft">
                Confirmed quality {skill.topPetCq.toFixed(1)}, best over {formatInt(headliner.bestDistance)}m
                {headliner.elo != null ? `, ELO ${formatInt(headliner.elo)}` : ""}.
              </p>
              <div className="mt-2"><RevealBar pct={headliner.revealPct} /></div>
            </div>
          </div>
        </div>
      )}

      {/* 2. One-click Develop: send the standout sets straight into Develop Mode. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="type-micro uppercase tracking-wider text-ink-faint">Develop in one click</span>
        <DevelopButton href={developHref(wallet, aTeam.map((p) => p.id), "A-Team")} label="Develop my A-Team" count={aTeam.length} />
        <DevelopButton href={developHref(wallet, hiddenGems.map((p) => p.id), "Hidden Gems")} label="Develop my Hidden Gems" count={hiddenGems.length} />
        <DevelopButton href={developHref(wallet, revealQueue.map((r) => r.id), "Next reveals")} label="Develop next reveals" count={revealQueue.length} />
      </div>
      <p className="type-micro mt-1.5 normal-case text-ink-faint">Pre-selects that set in Develop Mode (eligible horses only, capped at the field size). You still review and sign, nothing auto-enters.</p>

      {/* 3. YOUR A-TEAM: standouts and why, best first. */}
      {aTeam.length > 0 && (
        <div className="mt-6">
          <h3 className="type-section mb-3 text-ink">Your A-Team</h3>
          <div className="panel divide-y" style={{ borderColor: "var(--line)" }}>
            {aTeam.map((p, i) => (
              <ATeamRow key={p.id} p={p} rank={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* 4. CLOSEST TO REVEALING: the actionable develop-next list. */}
      {revealQueue.length > 0 && (
        <div className="mt-6">
          <h3 className="type-section mb-1 text-ink">Closest to revealing</h3>
          <p className="type-micro mb-3 normal-case text-ink-faint">Nearest their next stat unlock, so a few races go furthest here.</p>
          <div className="panel divide-y" style={{ borderColor: "var(--line)" }}>
            {revealQueue.map((r) => (
              <RevealRow key={r.id} r={r} />
            ))}
          </div>
        </div>
      )}

      {/* 5. AT A GLANCE: honest framing, the average rank is one quiet number only. */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Glance label="Hatched" value={`${formatInt(summary.hatchedCount)} of ${formatInt(summary.petCount)}`} />
        <Glance label="Proven horses" value={formatInt(skill.provenCount)} />
        <Glance label="Your best horse" value={skill.topPetPercentile != null ? pctOfField(skill.topPetPercentile) : "unrated"} accent />
        <Glance
          label="Estimated value"
          value={stableValue.lowEth != null && stableValue.highEth != null ? `${formatEth(stableValue.lowEth, 2)} to ${formatEth(stableValue.highEth, 2)} est.` : "unknown"}
        />
      </div>
    </section>
  );
}

function ATeamRow({ p, rank }: { p: PetCardDTO; rank: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 p-3">
      <div className="flex items-center gap-2.5">
        <span className="type-micro tabular-nums text-ink-faint">{rank}</span>
        <Link href={`/pet/${p.id}`} className="type-data text-ink transition-paddock hover:text-glow">{p.name ?? `#${p.id}`}</Link>
        <RarityBadge rarity={p.rarity.value} size="sm" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="type-micro normal-case text-ink-faint">CQ <span className="text-ink-soft">{p.confirmedQuality.toFixed(1)}</span></span>
        <span className="type-micro normal-case text-ink-faint">upside <span className="text-ink-soft">{p.upside.toFixed(1)}</span></span>
        <span className="type-micro normal-case text-ink-faint">{formatInt(p.bestDistance)}m</span>
        {p.elo != null && <span className="type-micro normal-case text-ink-faint">ELO <span className="text-ink-soft">{formatInt(p.elo)}</span></span>}
        <RevealBar pct={p.revealPct} />
      </div>
    </div>
  );
}

function RevealRow({ r }: { r: RevealQueueItem }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 p-3">
      <Link href={`/pet/${r.id}`} className="type-data text-ink transition-paddock hover:text-glow">{r.name ?? `#${r.id}`}</Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {r.nextMilestoneIn != null && (
          <span className="type-micro normal-case" style={{ color: "var(--gold)" }}>{r.nextMilestoneIn} {r.nextMilestoneIn === 1 ? "reveal" : "reveals"} to next unlock</span>
        )}
        <span className="type-micro normal-case text-ink-faint">upside <span className="text-ink-soft">{r.upside.toFixed(1)}</span></span>
        <RevealBar pct={r.revealPct} />
      </div>
    </div>
  );
}

function Glance({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel p-3">
      <p className="type-micro uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="type-data mt-0.5" style={{ color: accent ? "var(--glow)" : "var(--ink-soft)" }}>{value}</p>
    </div>
  );
}
