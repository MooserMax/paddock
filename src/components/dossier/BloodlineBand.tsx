import Link from "next/link";
import PetPortrait from "@/components/PetPortrait";
import Panel from "@/components/ui/Panel";
import { rarityDisplay } from "@/lib/display";
import { formatEth } from "@/lib/format";
import type { Lineage, LineageNode } from "@/lib/api/types";

// Surface 1: the Bloodline band on the dossier. Ancestry (Duelborn only, never invented for
// genesis) plus Line analytics (any pet with offspring). Summary-first, expandable, editorial style.
// The full interactive tree is deferred; "View full bloodline" points at a stub.

function sexInitial(s: string | null) { return s ? s[0].toUpperCase() : "?"; }

function NodeLine({ n, showRole }: { n: LineageNode; showRole?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-9 w-9 overflow-hidden rounded" style={{ flex: "0 0 auto" }}>
        <PetPortrait src={n.imgUrl} alt={`Gigling #${n.id}`} size={36} />
      </span>
      <span className="type-data">
        <Link href={`/pet/${n.id}`} className="transition-paddock text-ink hover:text-glow">#{n.id}</Link>{" "}
        <span style={{ color: rarityDisplay(n.rarity.value).color }}>{n.rarity.name}</span>
        <span className="text-ink-faint"> gen {n.generation} {sexInitial(n.sex)}{n.topTrait ? ` · ${n.topTrait}` : ""}</span>
        {showRole && n.role && <span className="type-micro ml-1 uppercase tracking-wider" style={{ color: n.role === "fell" ? "var(--brick)" : "var(--green)" }}>{n.role}</span>}
      </span>
    </span>
  );
}

function Chip({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border hairline px-3 py-2" style={{ background: "var(--paper-raised)" }}>
      <p className="type-micro uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="type-data mt-0.5" style={{ color: tone ?? "var(--ink)" }}>{value}</p>
    </div>
  );
}

export default function BloodlineBand({ lineage, focalName }: { lineage: Lineage; focalName: string }) {
  const { focal, isGenesis, ancestors, offspring, analytics, counts } = lineage;
  const parents = ancestors.filter((a) => (a.depth ?? 1) === 1);
  const hasAncestry = !isGenesis && parents.length > 0;
  const hasLine = counts.directOffspring > 0;
  const { climb, trait, value } = analytics;

  const plainRead = hasAncestry
    ? `${focal.rarity.name}, from ${parents.map((p) => `${p.rarity.name} #${p.id} (${p.role})`).join(" x ")}. Rarity held at the lower parent; gender copied from the fallen; +5/gen speed carried.`
    : null;

  return (
    <Panel eyebrow="Bloodline" title={isGenesis ? "A founding line" : "Ancestry and line"} note="Lineage as intelligence: where this Gigling came from and what its line produces." className="mt-6">
      {hasAncestry && (
        <div className="mb-5">
          <p className="type-micro mb-2 uppercase tracking-wider text-ink-faint">Ancestry</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {parents.map((p) => <NodeLine key={p.id} n={p} showRole />)}
          </div>
          {plainRead && <p className="type-body mt-3 text-ink-soft">{plainRead}</p>}
        </div>
      )}

      <div>
        <p className="type-micro mb-2 uppercase tracking-wider text-ink-faint">Line</p>
        {hasLine ? (
          <>
            <p className="type-body text-ink">
              This line has produced <span style={{ color: "var(--gold)" }}>{counts.directOffspring}</span> Duelborn across {counts.generationsSpanned} generation{counts.generationsSpanned === 1 ? "" : "s"}
              {counts.totalDescendants > counts.directOffspring ? ` (${counts.totalDescendants} descendants in all).` : "."}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Chip label="Rarity climbs" tone={climb.observed > 0 ? "var(--gold)" : "var(--ink-soft)"}
                value={climb.total > 0 ? <>{climb.observed} of {climb.total} climbed <span className="type-micro text-ink-faint">vs ~{climb.expectedPct}% expected</span></> : "no duels yet"} />
              <Chip label="Trait concentration" tone={trait.dominant ? "var(--glow)" : "var(--ink-soft)"}
                value={trait.revealed > 0 ? <>{trait.count} of {trait.revealed} carry {trait.dominant}</> : "reveals as they race"} />
              <Chip label="Est. bloodline value"
                value={value.lowEth != null ? <>{formatEth(value.lowEth, 3)} <span className="text-ink-faint">to</span> {formatEth(value.highEth ?? 0, 3)}{value.thin ? <span className="type-micro text-ink-faint"> · thin</span> : ""}</> : "thin comps"} />
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-ink">Show the {offspring.length} offspring</summary>
              <ul className="mt-2 space-y-2">
                {offspring.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                    <NodeLine n={o} />
                    <span className="type-micro uppercase tracking-wider text-ink-faint">this Gigling {o.role === "fell" ? <span style={{ color: "var(--brick)" }}>fell</span> : <span style={{ color: "var(--green)" }}>survived</span>}</span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="type-body text-ink-soft">This line starts here. No Duelborn from this Gigling yet.</p>
        )}
      </div>

      <p className="type-micro mt-4 normal-case text-ink-faint">
        <Link href={`/bloodline/${focal.id}`} className="underline transition-paddock hover:text-glow">View full bloodline</Link>
        {" "}(the visual tree arrives as generations deepen).
      </p>
    </Panel>
  );
}
