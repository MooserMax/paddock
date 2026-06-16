import Link from "next/link";
import type { RaceDetail, OddsResponse } from "@/lib/api/types";
import Panel from "@/components/ui/Panel";
import { TRACK_LABEL } from "@/lib/display";
import { formatPct } from "@/lib/format";

// The results view for a race that has already resolved. A user looking at a
// finished race wants the outcome, not a hypothetical "should you enter." So we
// lead with the actual finishing order, and then grade our own pre-race call
// against it: the calibration-page honesty applied to the exact race on screen.
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default function RaceResult({
  race,
  odds,
  markedPetId,
}: {
  race: RaceDetail;
  odds?: OddsResponse | null;
  markedPetId?: number;
}) {
  // Our pre-race ranking: the odds model when we have it (real probabilities),
  // otherwise the threat order by shrunk win rate (a rank, no fake percentage).
  const pred = new Map<number, { rank: number; prob: number | null }>();
  if (odds && odds.entrants.length) {
    odds.entrants.forEach((e, i) => pred.set(e.petId, { rank: i + 1, prob: e.winProbability }));
  } else {
    [...race.entrants]
      .sort((a, b) => b.shrunkWinRate - a.shrunkWinRate)
      .forEach((e, i) => pred.set(e.petId, { rank: i + 1, prob: null }));
  }

  const order = [...race.entrants].sort((a, b) => {
    const ap = a.finishPosition ?? 99;
    const bp = b.finishPosition ?? 99;
    return ap - bp;
  });
  const winner = race.entrants.find((e) => e.finishPosition === 1) ?? null;
  const favoriteId = [...pred.entries()].find(([, v]) => v.rank === 1)?.[0] ?? null;
  const favorite = favoriteId != null ? race.entrants.find((e) => e.petId === favoriteId) ?? null : null;
  const favoriteHit = !!(winner && favorite && winner.petId === favorite.petId);

  const winnerPred = winner ? pred.get(winner.petId) : undefined;
  const favProb = favorite ? pred.get(favorite.petId)?.prob ?? null : null;

  const trackLabel = race.trackLength ? TRACK_LABEL[race.trackLength] ?? `${race.trackLength}m` : "Unknown track";
  const accent = favoriteHit ? "var(--green)" : "var(--gold)";

  const favName = (e: typeof favorite) => e?.name ?? `#${e?.petId}`;

  return (
    <div className="space-y-5">
      {/* Self-grade: how our pre-race call held up, never hidden. */}
      {winner && (
        <div className="rounded-lg border p-4" style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 8%, transparent)` }}>
          <p className="type-micro uppercase tracking-wider" style={{ color: accent }}>
            {favoriteHit ? "The model called it" : "How our call held up"}
          </p>
          {favoriteHit ? (
            <p className="type-body mt-1 text-ink">
              Our favorite{" "}
              <Link href={`/pet/${favorite!.petId}`} className="text-ink transition-paddock hover:text-glow">{favName(favorite)}</Link>
              {favProb != null ? ` (${formatPct(favProb, 1)} predicted)` : ""} won.
            </p>
          ) : (
            <p className="type-body mt-1 text-ink-soft">
              Predicted favorite{" "}
              <Link href={`/pet/${favorite?.petId}`} className="text-ink transition-paddock hover:text-glow">{favName(favorite)}</Link>
              {favProb != null ? ` (${formatPct(favProb, 1)})` : ""}{" "}
              finished {favorite?.finishPosition ? ordinal(favorite.finishPosition) : "off the board"}. Actual winner{" "}
              <Link href={`/pet/${winner.petId}`} className="text-ink transition-paddock hover:text-glow">{winner.name ?? `#${winner.petId}`}</Link>
              {winnerPred ? ` was our ${ordinal(winnerPred.rank)} pick${winnerPred.prob != null ? `, ${formatPct(winnerPred.prob, 1)}` : ""}` : ""}.
            </p>
          )}
          <p className="type-micro mt-2 normal-case text-ink-faint">
            One race is an anecdote. The model grades itself across every race on the{" "}
            <Link href="/calibration" className="underline transition-paddock hover:text-glow">calibration page</Link>.
          </p>
        </div>
      )}

      <Panel
        eyebrow={`${trackLabel} · ${race.fieldSize ?? race.entrants.length} ran`}
        title="Final result"
        note={odds ? "Each horse shows what our model predicted before the gate." : "Resolved race, actual order."}
      >
        <div>
          {order.map((e) => {
            const p = pred.get(e.petId);
            const pos = e.finishPosition ?? null;
            const podium = pos === 1 ? "var(--gold)" : pos === 2 ? "var(--ink-soft)" : pos === 3 ? "var(--brick)" : "var(--ink-faint)";
            return (
              <div
                key={e.petId}
                className="flex items-center gap-3 border-b hairline py-3 last:border-0"
                style={e.petId === markedPetId ? { background: "color-mix(in srgb, var(--cyan) 8%, transparent)" } : undefined}
              >
                <div className="w-7 text-center">
                  <span className="type-data tabular-nums" style={{ color: podium }}>{pos ? ordinal(pos) : "-"}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/pet/${e.petId}`} className="type-data text-ink transition-paddock hover:text-glow">
                      {e.name ?? `#${e.petId}`}
                    </Link>
                    {e.petId === markedPetId && <span className="type-micro uppercase" style={{ color: "var(--cyan)" }}>your horse</span>}
                    {e.isShark ? (
                      <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>shark</span>
                    ) : e.highElo ? (
                      <span className="type-micro uppercase tracking-wider" style={{ color: "var(--glow)" }}>in form</span>
                    ) : null}
                  </div>
                  <div className="type-micro text-ink-faint">
                    {e.racesRun ? `${e.wins}/${e.racesRun} raw` : "no prior races"}
                    {e.elo != null ? ` · elo ${Math.round(e.elo)}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {p ? (
                    <>
                      <div className="type-data tabular-nums text-ink-soft">
                        {p.prob != null ? formatPct(p.prob, 1) : `#${p.rank}`}
                        <span className="text-ink-faint"> {p.prob != null ? "predicted" : "our pick"}</span>
                      </div>
                      {p.prob != null && <div className="type-micro text-ink-faint">our {ordinal(p.rank)} pick</div>}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
