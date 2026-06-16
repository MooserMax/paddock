import Link from "next/link";
import type { Metadata } from "next";
import { api, ApiClientError } from "@/lib/api/client";
import type { WalletSummary } from "@/lib/api/types";
import PetCard from "@/components/PetCard";
import Panel from "@/components/ui/Panel";
import WalletSearch from "@/components/WalletSearch";
import { TRACK_LABEL } from "@/lib/display";
import { formatEth, formatInt, formatScore, shortAddress, ownerDisplay } from "@/lib/format";
import { resolveOwnerName } from "@/lib/accounts";

export const revalidate = 60;

interface PageProps {
  params: { address: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const addr = decodeURIComponent(params.address);
  const label = await resolveOwnerName(addr); // username when known, else truncated
  return {
    title: `Stable ${label}`,
    description: `Paddock stable intelligence report for ${label}: A-team, hidden gems, reveal queue, and estimated value.`,
    openGraph: { images: [`/wallet/${addr}/opengraph-image`] },
  };
}

export default async function WalletPage({ params }: PageProps) {
  const address = decodeURIComponent(params.address);

  let summary: WalletSummary | null = null;
  let errorMessage: string | null = null;
  try {
    summary = await api.wallet(address, { revalidate: 60 });
  } catch (err) {
    errorMessage = err instanceof ApiClientError ? err.message : "Something went wrong reading this stable.";
  }

  if (!summary) {
    return (
      <div className="mx-auto max-w-page px-4 py-16 md:px-6">
        <Panel eyebrow="Stable lookup" title="That address did not read">
          <p className="type-body text-ink-soft">{errorMessage}</p>
          <div className="mt-6 max-w-xl">
            <WalletSearch size="md" />
          </div>
        </Panel>
      </div>
    );
  }

  const { stableValue } = summary;
  const allEggs = summary.petCount > 0 && summary.hatchedCount === 0;
  const empty = summary.petCount === 0;

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      {/* Header */}
      <header className="assemble flex flex-col gap-2">
        <p className="eyebrow">Stable intelligence report</p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="type-page-title text-ink">{ownerDisplay(summary.name, summary.address)}</h1>
          <span className="type-data text-ink-faint">
            {formatInt(summary.petCount)} Giglings · {formatInt(summary.hatchedCount)} hatched
          </span>
        </div>
        {/* The URL is the address, so always keep the full wallet visible to copy. */}
        <p className="type-micro tabular-nums text-ink-faint" title={summary.address}>{summary.address}</p>
      </header>

      {empty ? (
        <Panel className="assemble mt-8" eyebrow="Empty paddock" title="No Giglings here">
          <p className="type-body text-ink-soft">
            This wallet holds no Giglings that Paddock tracks. Paste another address, or load a demo stable to see a full report.
          </p>
          <div className="mt-6 max-w-xl">
            <WalletSearch size="md" />
          </div>
        </Panel>
      ) : (
        <>
          {/* Stable value + flags: the above-the-fold headline on mobile */}
          <div className="assemble mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]" style={{ animationDelay: "40ms" }}>
            <Panel eyebrow="Estimated stable value" title="" note="Band-based, summed from comparable-sales valuations. An estimate, not a quote.">
              {stableValue.lowEth !== null ? (
                <div>
                  <p className="type-page-title tabular-nums text-ink">
                    {formatEth(stableValue.lowEth, 2)} <span className="text-ink-faint">to</span> {formatEth(stableValue.highEth, 2)}
                  </p>
                  <p className="type-micro mt-2 normal-case text-ink-faint">
                    From {formatInt(stableValue.compCountTotal)} comparable sales across the hatched stable. Horses with thin comps are excluded from the total.
                  </p>
                </div>
              ) : (
                <p className="type-body text-ink-soft">Comps are too thin to put a number on this stable yet. We will not invent one.</p>
              )}
            </Panel>

            <Panel eyebrow="Flags" title="">
              {summary.flags.length === 0 ? (
                <p className="type-data text-ink-faint">No standout flags.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.flags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="asterisk mt-0.5 leading-none">✳</span>
                      <span className="type-data text-ink-soft">{f}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {allEggs && (
            <div className="assemble mt-6 rounded-lg border p-5" style={{ borderColor: "var(--cyan)", background: "color-mix(in srgb, var(--cyan) 8%, transparent)" }}>
              <p className="type-card-title text-ink">This stable is all potential. Nothing hatched yet.</p>
              <p className="type-body mt-1 text-ink-soft">
                Every Gigling here is still an egg, so there is no proven quality to grade. The hidden gems below rank them by upside, the lottery-ticket read.
              </p>
            </div>
          )}

          {/* A-team */}
          {summary.aTeam.length > 0 && (
            <Module eyebrow="A-team" title="Highest confirmed quality" note="Proven from revealed data. These are the horses to run when it counts." delay="80ms">
              <div className="grid gap-3 sm:grid-cols-2">
                {summary.aTeam.map((p) => (
                  <PetCard key={p.id} pet={p} metric="cq" />
                ))}
              </div>
            </Module>
          )}

          {/* Hidden gems */}
          {summary.hiddenGems.length > 0 && (
            <Module eyebrow="Hidden gems" title="Highest upside, still unrevealed" note="Potential, not proof. Lottery tickets worth revealing." delay="120ms">
              <div className="grid gap-3 sm:grid-cols-2">
                {summary.hiddenGems.map((p) => (
                  <PetCard key={p.id} pet={p} metric="upside" />
                ))}
              </div>
            </Module>
          )}

          {/* Reveal queue + track assignments */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel eyebrow="Reveal queue" title="Race these next" note="Ordered by proximity to the next trait-reveal milestone.">
              {summary.revealQueue.length === 0 ? (
                <p className="type-data text-ink-faint">No horses near a reveal milestone.</p>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                  {summary.revealQueue.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 border-b hairline py-2.5 last:border-0">
                      <Link href={`/pet/${r.id}`} className="type-data text-ink transition-paddock hover:text-glow">
                        {r.name ?? `#${r.id}`}
                      </Link>
                      <span className="type-micro uppercase text-ink-faint">
                        {r.nextMilestoneIn != null ? `${r.nextMilestoneIn} race${r.nextMilestoneIn === 1 ? "" : "s"} to reveal` : "no milestone"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel eyebrow="Track assignments" title="Best horse per distance" note="The strongest fit in this stable for each track length.">
              <ul className="space-y-2.5">
                {summary.trackAssignments.map((t) => (
                  <li key={t.distance} className="flex items-center justify-between gap-3">
                    <span className="type-micro uppercase tracking-wider text-ink-soft">{TRACK_LABEL[t.distance]}</span>
                    {t.petId ? (
                      <Link href={`/pet/${t.petId}`} className="type-data text-ink transition-paddock hover:text-glow">
                        {t.name ?? `#${t.petId}`} <span className="text-ink-faint">· {formatScore(t.fit)} fit</span>
                      </Link>
                    ) : (
                      <span className="type-data text-ink-faint">no fit</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}

      <p className="type-micro mt-8 normal-case text-ink-faint">
        Served by{" "}
        <Link href={`/api/v1/wallet/${summary.address}`} className="underline transition-paddock hover:text-glow">
          /api/v1/wallet/{shortAddress(summary.address)}
        </Link>
        . Source: {summary.meta.source}.
      </p>
    </div>
  );
}

function Module({ eyebrow, title, note, delay, children }: { eyebrow: string; title: string; note: string; delay: string; children: React.ReactNode }) {
  return (
    <section className="assemble mt-8" style={{ animationDelay: delay }}>
      <header className="mb-3">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="type-section text-ink">{title}</h2>
        <p className="type-micro mt-0.5 normal-case text-ink-faint">{note}</p>
      </header>
      {children}
    </section>
  );
}
