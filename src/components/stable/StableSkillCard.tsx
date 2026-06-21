import Panel from "@/components/ui/Panel";
import type { StableSkill } from "@/lib/api/types";
import { formatPercentile, formatScore, formatInt } from "@/lib/format";

// The stable-skill card on the stable report, in the existing Panel style. The
// percentile is the hero (coral accent), the score secondary, with the proven
// basis always shown. Three honest states: ranked, limited (1-2 proven, scored
// but not ranked), and none (0 proven, no fabricated figure). The honesty caption
// frames it precisely: proven roster quality, not racing skill, not value.
const HONESTY = "Proven roster quality only. Says nothing about unrevealed horses, and does not measure how you race.";

export default function StableSkillCard({ skill }: { skill: StableSkill }) {
  if (skill.state === "none") {
    return (
      <Panel className="assemble" eyebrow="Stable skill" title="" note={HONESTY}>
        <p className="type-card-title text-ink">Not enough revealed horses to rank yet.</p>
        <p className="type-micro mt-2 normal-case text-ink-faint">
          Reveal or race horses to earn a stable grade. The score reads proven horses only, and this stable has none yet.
        </p>
      </Panel>
    );
  }

  if (skill.state === "limited") {
    return (
      <Panel className="assemble" eyebrow="Stable skill" title="" note={HONESTY}>
        <p className="type-page-title tabular-nums text-ink">{formatScore(skill.score)}</p>
        <p className="type-micro mt-1 uppercase tracking-wider text-ink-faint">Limited data, not ranked</p>
        <p className="type-micro mt-2 normal-case text-ink-faint">
          Based on {formatInt(skill.provenCount)} proven horse{skill.provenCount === 1 ? "" : "s"} of {formatInt(skill.totalHorses)} total. Reveal at least 3 to join the ranked board.
        </p>
      </Panel>
    );
  }

  // ranked
  return (
    <Panel className="assemble" eyebrow="Stable skill" title="" note={HONESTY}>
      <p className="type-page-title tabular-nums" style={{ color: "var(--glow)" }}>
        {formatPercentile(skill.percentile)} <span className="type-data uppercase tracking-wider text-ink-faint">of stables</span>
      </p>
      <p className="type-data mt-1 tabular-nums text-ink-soft">
        Skill score {formatScore(skill.score)} · rank {formatInt(skill.rank)} of {formatInt(skill.eligibleTotal)}
      </p>
      <p className="type-micro mt-2 normal-case text-ink-faint">
        Based on {formatInt(skill.provenCount)} proven horses of {formatInt(skill.totalHorses)} total.
      </p>
    </Panel>
  );
}
