import type { RaceDetail, OddsResponse } from "@/lib/api/types";
import VerdictBanner from "./VerdictBanner";
import EntrantRow from "./EntrantRow";
import RaceResult from "./RaceResult";
import Panel from "@/components/ui/Panel";
import { TRACK_LABEL } from "@/lib/display";
import { formatEth } from "@/lib/format";

// The full scanner read for a race. A resolved race shows its actual result and
// a self-grade of our pre-race call; an upcoming race shows the verdict and the
// field ranked by threat. Shared by /race/[id] and /scanner.
export default function ScannerVerdict({ race, markedPetId, odds }: { race: RaceDetail; markedPetId?: number; odds?: OddsResponse | null }) {
  const isResolved = race.resolved && race.entrants.some((e) => e.finishPosition != null);
  if (isResolved) {
    return <RaceResult race={race} odds={odds} markedPetId={markedPetId} />;
  }

  const sorted = [...race.entrants].sort((a, b) => b.shrunkWinRate - a.shrunkWinRate);
  const feeEth = race.entryFeeWei ? Number(race.entryFeeWei) / 1e18 : 0;

  return (
    <div className="space-y-5">
      <VerdictBanner verdict={race.verdict} />

      <p className="type-micro rounded-md border px-3 py-2 normal-case leading-relaxed text-ink-faint" style={{ borderColor: "var(--line)" }}>
        <span className="uppercase" style={{ color: "var(--gold)" }}>What this cannot know: </span>
        {race.verdict.caveat}
      </p>

      <Panel
        eyebrow={`${race.trackLength ? TRACK_LABEL[race.trackLength] ?? `${race.trackLength}m` : "Unknown track"} · ${race.fieldSize ?? race.entrants.length} field`}
        title="The field, ranked by threat"
        note={`Payout ${race.payoutBps ? race.payoutBps.filter((b) => b > 0).map((b) => `${(b / 100).toFixed(0)}%`).join(" / ") : "unknown"}${feeEth > 0 ? ` · entry ${formatEth(feeEth, 4)}` : " · free race"}`}
      >
        <div>
          {sorted.map((e) => (
            <EntrantRow key={e.petId} entrant={e} marked={e.petId === markedPetId} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
