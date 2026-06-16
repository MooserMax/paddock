import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import { ApiClientError } from "@/lib/api/client";
import type { PetDossier } from "@/lib/api/types";
import StatRangeBar from "@/components/StatRangeBar";
import RarityBadge from "@/components/RarityBadge";
import Panel from "@/components/ui/Panel";
import TraitRow from "@/components/dossier/TraitRow";
import TrackFitBars from "@/components/dossier/TrackFitBars";
import OwnerLabel from "@/components/OwnerLabel";
import { STAT_LABEL, TRACK_LABEL } from "@/lib/display";
import { formatEth, formatPct, formatScore, ordinal } from "@/lib/format";

export const revalidate = 120;

async function load(id: string): Promise<PetDossier | null> {
  try {
    return await api.pet(id, { revalidate: 120 });
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const dossier = await load(params.id);
  if (!dossier) return { title: "Gigling not found" };
  const desc = `${dossier.rarity.name} Gigling. Confirmed quality ${formatScore(dossier.scores.confirmedQuality)}, ${formatPct(dossier.revealPct)} revealed, best at ${dossier.scores.bestDistance}m.`;
  return {
    title: `Gigling #${dossier.id}`,
    description: desc,
    openGraph: { title: `Paddock dossier: Gigling #${dossier.id}`, description: desc, images: [`/pet/${dossier.id}/opengraph-image`] },
    twitter: { card: "summary_large_image", title: `Gigling #${dossier.id}`, description: desc },
  };
}

const STAT_ACCENT: Record<string, string> = {
  start: "var(--cyan)",
  speed: "var(--glow)",
  stamina: "var(--green)",
  finish: "var(--gold)",
};

export default async function PetPage({ params }: { params: { id: string } }) {
  const d = await load(params.id);
  if (!d) notFound();

  const neverRaced = !d.hatched || d.shark.racesRun === 0;
  const statKeys = ["start", "speed", "stamina", "finish"] as const;

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      {/* Identity header */}
      <header className="assemble grid gap-6 md:grid-cols-[200px_1fr] md:gap-8">
        <div
          className="relative aspect-square w-full overflow-hidden rounded-lg border hairline bg-dotgrid"
          style={{ maxWidth: 200 }}
        >
          {d.imgUrl ? (
            <Image src={d.imgUrl} alt={`Gigling #${d.id}`} width={200} height={200} className="h-full w-full object-cover" priority />
          ) : (
            <div className="flex h-full items-center justify-center type-micro text-ink-faint">no image</div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="type-page-title text-ink">{d.name ?? `#${d.id}`}</h1>
              <RarityBadge rarity={d.rarity.value} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="type-data text-ink-soft">{d.faction.name}</span>
              <span className="type-micro uppercase text-ink-faint">Gigling #{d.id}</span>
              {d.ownerAddress && (
                <span className="type-micro uppercase text-ink-faint">
                  owner{" "}
                  <OwnerLabel address={d.ownerAddress} name={d.ownerName} className="transition-paddock hover:text-glow" />
                </span>
              )}
            </div>
          </div>

          {/* Reveal progress, made prominent: known vs unknown at a glance. */}
          <div className="max-w-md">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="eyebrow">Reveal progress</span>
              <span className="type-data tabular-nums text-ink">{formatPct(d.revealPct)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--paper-sunken)" }}>
              <div className="h-full rounded-full transition-paddock" style={{ width: `${Math.max(2, d.revealPct * 100)}%`, background: "var(--glow)" }} />
            </div>
            <p className="type-micro mt-1.5 normal-case text-ink-faint">
              {d.scores.traitsRevealed} of {d.scores.traitsTotal} trait stars revealed. Stats narrow as this horse races.
            </p>
          </div>
        </div>
      </header>

      {/* Headline scores */}
      <div className="assemble mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border hairline md:grid-cols-4" style={{ background: "var(--line)", animationDelay: "60ms" }}>
        <ScoreCell label="Confirmed quality" value={formatScore(d.scores.confirmedQuality)} sub="proven, revealed only" accent="var(--gold)" />
        <ScoreCell label="Upside" value={formatScore(d.scores.upside)} sub="potential, not proof" accent="var(--cyan)" />
        <ScoreCell label="Best distance" value={`${d.scores.bestDistance}m`} sub={TRACK_LABEL[d.scores.bestDistance]?.split(" ")[1] ?? ""} accent="var(--glow)" />
        <ScoreCell
          label="Win rate"
          value={formatPct(d.shark.shrunkWinRate)}
          sub={d.shark.racesRun ? `shrunk · ${d.shark.wins}/${d.shark.racesRun} raw` : "no races yet"}
          accent="var(--green)"
        />
      </div>

      {neverRaced && (
        <div className="assemble mt-6 rounded-lg border p-5" style={{ borderColor: "var(--cyan)", background: "color-mix(in srgb, var(--cyan) 8%, transparent)" }}>
          <p className="type-card-title text-ink">All potential. Nothing proven yet.</p>
          <p className="type-body mt-1 text-ink-soft">
            This Gigling has not raced, so every stat is a wide range and every trait star is hidden. Its score below is upside, the lottery-ticket read, not a confirmed grade. Race it to start revealing.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Stats + traits */}
        <div className="space-y-6">
          <Panel eyebrow="The four stats" title="Revealed ranges" note="Never a fabricated midpoint. The band narrows as the horse races.">
            <div className="space-y-5">
              {statKeys.map((k) => (
                <StatRangeBar
                  key={k}
                  label={STAT_LABEL[k]}
                  min={d.stats[k].low}
                  max={d.stats[k].high}
                  reveals={d.stats[k].reveals}
                  accent={STAT_ACCENT[k]}
                />
              ))}
            </div>
          </Panel>

          <Panel eyebrow="Traits" title="Carried from birth, stars revealed at milestones" note="Each trait shows its study-measured win-rate lift.">
            <div>
              {d.traits.length === 0 ? (
                <p className="type-data text-ink-faint">No traits on record for this Gigling.</p>
              ) : (
                d.traits.map((t) => <TraitRow key={t.id} trait={t} />)
              )}
            </div>
          </Panel>
        </div>

        {/* Track fit + valuation + shark. Sticky on desktop so the shorter rail
            follows the long stats column instead of leaving a void. */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Panel eyebrow="Track fit" title={`Best at ${d.scores.bestDistance}m`} note="From the study's trait-by-distance lifts and the revealed stat profile.">
            <TrackFitBars fit={d.scores.fit} best={d.scores.bestDistance} />
          </Panel>

          <Panel eyebrow="Shark profile" title="Finishing record">
            <dl className="grid grid-cols-2 gap-4">
              <Stat label="Shrunk win rate" value={formatPct(d.shark.shrunkWinRate)} />
              <Stat label="Raw record" value={d.shark.racesRun ? `${d.shark.wins}/${d.shark.racesRun}` : "none"} />
              <Stat label="ELO" value={d.shark.elo != null ? String(Math.round(d.shark.elo)) : "unrated"} />
              <Stat label="Raw win rate" value={d.shark.rawWinRate != null ? formatPct(d.shark.rawWinRate) : "n/a"} />
            </dl>
          </Panel>

          <Panel eyebrow="Valuation" title="Comparable-sales band">
            {d.valuation.thin ? (
              <div>
                <p className="type-data text-ink">Comps are thin.</p>
                <p className="type-micro mt-1 normal-case text-ink-faint">{d.valuation.note}</p>
              </div>
            ) : (
              <div>
                <p className="type-section text-ink">
                  {formatEth(d.valuation.lowEth, 3)} <span className="text-ink-faint">to</span> {formatEth(d.valuation.highEth, 3)}
                </p>
                {d.valuation.lowConfidence && (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5" style={{ borderColor: "var(--gold)" }}>
                    <span className="type-micro uppercase tracking-wider" style={{ color: "var(--gold)" }}>
                      low confidence · {d.valuation.compCount} comps
                    </span>
                  </span>
                )}
                <p className="type-micro mt-1.5 normal-case text-ink-faint">{d.valuation.note}</p>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Race history */}
      <Panel eyebrow="Race history" title="Recent finishes" className="mt-6">
        {d.recentRaces.length === 0 ? (
          <p className="type-data text-ink-faint">No races on record yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse">
              <thead>
                <tr className="border-b hairline-strong text-left">
                  <th className="type-micro pb-2 uppercase text-ink-faint">Race</th>
                  <th className="type-micro pb-2 uppercase text-ink-faint">Finish</th>
                  <th className="type-micro pb-2 uppercase text-ink-faint">Field</th>
                  <th className="type-micro pb-2 uppercase text-ink-faint">Track</th>
                  <th className="type-micro pb-2 text-right uppercase text-ink-faint">Payout</th>
                </tr>
              </thead>
              <tbody>
                {d.recentRaces.map((r) => {
                  const won = r.finishPosition === 1;
                  const payoutEth = r.payoutWei ? Number(r.payoutWei) / 1e18 : 0;
                  return (
                    <tr key={r.raceId} className="border-b hairline last:border-0">
                      <td className="py-2.5">
                        <Link href={`/race/${r.raceId}`} className="type-data text-ink-soft transition-paddock hover:text-glow">
                          #{r.raceId}
                        </Link>
                      </td>
                      <td className="py-2.5">
                        <span className="type-data tabular-nums" style={{ color: won ? "var(--gold)" : "var(--ink)" }}>
                          {r.finishPosition ? ordinal(r.finishPosition) : "-"}
                        </span>
                      </td>
                      <td className="type-data py-2.5 tabular-nums text-ink-soft">{r.fieldSize ?? "-"}</td>
                      <td className="type-data py-2.5 tabular-nums text-ink-soft">{r.trackLength ? `${r.trackLength}m` : "-"}</td>
                      <td className="type-data py-2.5 text-right tabular-nums text-ink-soft">
                        {payoutEth > 0 ? formatEth(payoutEth, 4) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="type-micro mt-6 normal-case text-ink-faint">
        Every value on this page is served by{" "}
        <Link href={`/api/v1/pet/${d.id}`} className="underline transition-paddock hover:text-glow">
          /api/v1/pet/{d.id}
        </Link>
        . Source: {d.meta.source}.
      </p>
    </div>
  );
}

function ScoreCell({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="p-4" style={{ background: "var(--paper-raised)" }}>
      <p className="eyebrow">{label}</p>
      <p className="type-section mt-1 tabular-nums" style={{ color: accent }}>
        {value}
      </p>
      <p className="type-micro mt-0.5 normal-case text-ink-faint">{sub}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="type-micro uppercase text-ink-faint">{label}</dt>
      <dd className="type-data mt-0.5 tabular-nums text-ink">{value}</dd>
    </div>
  );
}
