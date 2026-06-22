import Link from "next/link";
import Panel from "@/components/ui/Panel";
import type { StableSkill } from "@/lib/api/types";
import { stableStanding, formatInt, formatScore, formatHorsePercentile } from "@/lib/format";

// The stable-skill card on the stable report. Leads with standing (rank, or a
// percentile near the very top), with a rank progress bar so a user reads their
// position instantly without needing to understand the raw score (which is in the
// API but never shown as a bare figure here). A faint "the mountain" marker shows
// the climb to the top tier. Three honest states: ranked, limited (1-2 proven,
// not ranked), none (0 proven, no fabricated figure). A short positive descriptor,
// not a disclaimer.
const DESCRIPTOR = "Ranked on each stable's proven horses.";

export default function StableSkillCard({ skill }: { skill: StableSkill }) {
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

  // ranked: hero standing + rank progress bar + mountain marker
  const total = skill.eligibleTotal;
  const rank = skill.rank ?? total;
  const fillPct = Math.max(2, ((total - rank + 1) / total) * 100);
  const mountainPct = ((total - Math.ceil(0.1 * total) + 1) / total) * 100; // top-10% position

  return (
    <Panel className="assemble" eyebrow="Stable skill" title="" note={DESCRIPTOR}>
      <p className="type-page-title tabular-nums" style={{ color: "var(--glow)" }}>
        {stableStanding(skill.percentile, skill.rank, total)}
      </p>
      {rank === 1 && (
        <p className="type-data mt-0.5 uppercase tracking-wider" style={{ color: "var(--glow)" }}>The top stable in the game</p>
      )}

      {/* Rank progress bar, same style as the pet dossier reveal bar. Low ranks
          show a low fill on purpose; the faint tick marks the top-10% climb. */}
      <div className="relative mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--paper-sunken)" }} role="img" aria-label={`Rank ${rank} of ${total}`}>
        <div className="h-full rounded-full transition-paddock" style={{ width: `${fillPct}%`, background: "var(--glow)" }} />
        <div className="absolute top-0 h-full" style={{ left: `${mountainPct}%`, width: 2, background: "var(--ink-faint)" }} aria-hidden />
      </div>
      <div className="relative mt-1 h-3">
        <span className="type-micro absolute uppercase text-ink-faint" style={{ left: `${mountainPct}%`, transform: "translateX(-100%)" }}>top 10%</span>
      </div>

      <p className="type-micro mt-2 normal-case text-ink-faint">
        Based on {formatInt(skill.provenCount)} proven horses of {formatInt(skill.totalHorses)} total.
      </p>
      {skill.topPetId != null && skill.topPetCq != null && (
        <p className="type-micro mt-1 normal-case text-ink-faint">
          Best horse{" "}
          <Link href={`/pet/${skill.topPetId}`} className="text-ink-soft transition-paddock hover:text-glow">#{skill.topPetId}</Link>
          , quality {formatScore(skill.topPetCq)}
          {skill.topPetIsBest ? (
            <span style={{ color: "var(--glow)" }}>, the #1 horse in the game</span>
          ) : skill.topPetPercentile != null ? (
            <span style={{ color: "var(--glow)" }}>, {formatHorsePercentile(skill.topPetPercentile)} in the game</span>
          ) : null}
          .
        </p>
      )}
    </Panel>
  );
}
