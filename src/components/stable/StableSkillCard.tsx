import Link from "next/link";
import Panel from "@/components/ui/Panel";
import type { StableSkill, PetCardDTO } from "@/lib/api/types";
import { formatInt, formatScore, formatHorsePercentile } from "@/lib/format";

// The stable-skill card on the stable report. It leads with the stable's STANDOUT
// HORSE (its peak signal), never the stable-average rank: that average punishes large
// active stables (and Develop Mode, which lowers it) and reads as "last place", so the
// rank NUMBER appears nowhere here. Three honest states: ranked, limited (1-2 proven),
// none (0 proven). A short positive descriptor, not a disclaimer.
const DESCRIPTOR = "Your proven horses, by confirmed quality.";

export default function StableSkillCard({ skill, topPet }: { skill: StableSkill; topPet?: PetCardDTO | null }) {
  if (skill.state === "none") {
    return (
      <Panel className="assemble" eyebrow="Stable skill" title="" note={DESCRIPTOR}>
        <p className="type-card-title text-ink">Not enough revealed horses to rank yet.</p>
        <p className="type-micro mt-2 normal-case text-ink-faint">
          Reveal or race horses to earn a stable grade. The grade reads proven horses only, and this stable has none yet.
        </p>
      </Panel>
    );
  }

  if (skill.state === "limited") {
    return (
      <Panel className="assemble" eyebrow="Stable skill" title="" note={DESCRIPTOR}>
        <p className="type-card-title text-ink">Limited data, not ranked yet.</p>
        <p className="type-micro mt-2 normal-case text-ink-faint">
          Based on {formatInt(skill.provenCount)} proven horse{skill.provenCount === 1 ? "" : "s"} of {formatInt(skill.totalHorses)} total. Reveal at least 3 to join the ranked board.
        </p>
      </Panel>
    );
  }

  // ranked: lead with the STANDOUT horse, no rank number, no rank bar.
  const pct = skill.topPetPercentile != null ? formatHorsePercentile(skill.topPetPercentile) : null;
  const standing = skill.topPetIsBest ? "The #1 horse in the game" : pct ? `${pct} in the game` : "A proven horse";

  return (
    <Panel className="assemble" eyebrow="Stable skill" title="" note={DESCRIPTOR}>
      {skill.topPetId != null && skill.topPetCq != null ? (
        <>
          <p className="type-micro uppercase tracking-wider text-ink-faint">Your standout</p>
          <p className="type-page-title" style={{ color: "var(--glow)" }}>{standing}</p>
          <p className="type-data mt-1 text-ink-soft">
            <Link href={`/pet/${skill.topPetId}`} className="transition-paddock hover:text-glow">#{skill.topPetId}</Link>
            , confirmed quality {formatScore(skill.topPetCq)}
            {topPet ? `, best over ${formatInt(topPet.bestDistance)}m${topPet.elo != null ? `, ELO ${formatInt(topPet.elo)}` : ""}` : ""}.
          </p>
        </>
      ) : (
        <p className="type-card-title text-ink">A proven stable.</p>
      )}
      {/* Neutral stable context, never a rank or last-place framing. */}
      <p className="type-micro mt-3 normal-case text-ink-faint">
        {formatInt(skill.provenCount)} proven horses of {formatInt(skill.totalHorses)} total.
      </p>
    </Panel>
  );
}
