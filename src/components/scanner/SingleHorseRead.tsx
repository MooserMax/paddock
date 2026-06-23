import Link from "next/link";
import type { PetDossier } from "@/lib/api/types";
import Panel from "@/components/ui/Panel";
import RarityBadge from "@/components/RarityBadge";
import { TRACK_LABEL } from "@/lib/display";
import { formatScore, formatPct } from "@/lib/format";

// A scanner read for a single Gigling: the real workflow is grading a lobby as
// it fills, which often starts with one horse. Shows confirmed quality, upside,
// and fit for the chosen track, with a clear note to paste the rest as they join.
export default function SingleHorseRead({ pet, track }: { pet: PetDossier; track: number }) {
  const fit = pet.scores.fit[String(track) as keyof typeof pet.scores.fit] ?? 0;
  const fitsHere = pet.scores.bestDistance === track;

  return (
    <div className="space-y-5">
      <div className="assemble rounded-lg border p-5 md:p-6" style={{ borderColor: "var(--cyan)", background: "color-mix(in srgb, var(--cyan) 8%, transparent)" }}>
        <p className="type-micro uppercase tracking-widest" style={{ color: "var(--cyan)" }}>Single-horse read</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Link href={`/pet/${pet.id}`} className="type-section text-ink transition-paddock hover:text-glow">
            {pet.name ?? `#${pet.id}`}
          </Link>
          <RarityBadge rarity={pet.rarity.value} />
        </div>
        <p className="type-body mt-1 text-ink-soft">
          {fitsHere
            ? `A natural fit for ${TRACK_LABEL[track] ?? `${track}m`}: this is its best distance.`
            : `This horse is strongest at ${pet.scores.bestDistance}m, not ${track}m.`}
        </p>
      </div>

      <Panel eyebrow={`Read at ${TRACK_LABEL[track] ?? `${track}m`}`} title="What we know about this horse">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Confirmed quality" value={formatScore(pet.scores.confirmedQuality)} accent="var(--gold)" />
          <Stat label="Upside" value={formatScore(pet.scores.upside)} accent="var(--cyan)" />
          <Stat label={`Fit at ${track}m`} value={formatScore(fit)} accent={fitsHere ? "var(--glow)" : "var(--ink-soft)"} />
          <Stat label="Win rate" value={pet.shark.racesRun ? `${formatPct(pet.shark.wins / pet.shark.racesRun)}, ${pet.shark.wins} of ${pet.shark.racesRun}` : "0%, no races"} accent="var(--green)" />
        </dl>
      </Panel>

      <p className="type-micro rounded-md border px-3 py-2 normal-case leading-relaxed text-ink-faint" style={{ borderColor: "var(--line)" }}>
        Single-horse read. The scanner grades a field, so paste the rest of the lobby as they join to get the verdict: sharks, payout traps, and how your horse stacks up against the others.
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div>
      <dt className="type-micro uppercase text-ink-faint">{label}</dt>
      <dd className="type-data mt-0.5 tabular-nums" style={{ color: accent }}>{value}</dd>
    </div>
  );
}
