import Link from "next/link";
import type { RaceDetail, OddsResponse } from "@/lib/api/types";
import Panel from "@/components/ui/Panel";
import { TRACK_LABEL } from "@/lib/display";
import { formatPct } from "@/lib/format";

// The results view for a race that has already resolved. A user looking at a
// finished race wants the outcome, not a hypothetical "should you enter." So we
// lead with a patch-notes recap built ONLY from real finish data (order, times,
// margins) and our pre-race call, then the full finishing order. There is NO
// per-segment / position-over-time data in the payload (hasSegments=false), so we
// invent no motion, splits, or live commentary: every line is grounded in the
// final result.
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// Final time in seconds from on-chain ms.
const fmtSec = (ms: number, dp: number) => `${(ms / 1000).toFixed(dp)}s`;

// No verified per-race deep-link exists on the Gigaverse SPA (no documented or
// observable /racing/<id> route), so we link the Racing page honestly rather than
// ship a deep-link that may 404. A plain external anchor, CSP-compatible.
const GIGA_RACING_URL = "https://gigaverse.io/racing";

// One patch-notes line: a glow "+" marker and a real, finish-data claim.
function RecapLine({ children, tone }: { children: React.ReactNode; tone?: "gold" }) {
  return (
    <li className="flex gap-2">
      <span className="type-micro select-none" style={{ color: tone === "gold" ? "var(--gold)" : "var(--glow)" }} aria-hidden>+</span>
      <span className="type-data text-ink-soft" style={tone === "gold" ? { color: "var(--gold)" } : undefined}>{children}</span>
    </li>
  );
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

  const trackLabel = race.trackLength ? TRACK_LABEL[race.trackLength] ?? `${race.trackLength}m` : "Unknown track";
  const accent = favoriteHit ? "var(--green)" : "var(--gold)";

  const favName = (e: typeof favorite) => e?.name ?? `#${e?.petId}`;

  // Race-specific alpha from the entrants + verdict: the strength of the field, what
  // distinguished the winner, and any structural flag. Reads from real fields only and
  // generalizes across a shark field, a soft field, a chalk winner, or an upset.
  function buildReadout(w: NonNullable<typeof winner>): { field: string; winnerTail: string; trap: boolean } {
    const E = race.entrants;
    const elos = E.map((e) => e.elo).filter((x): x is number => x != null);
    const topElo = elos.length ? Math.max(...elos) : null;
    const sharks = E.filter((e) => e.isShark);
    const inForm = E.filter((e) => e.highElo && !e.isShark);
    // Proven = won a race other than (possibly) this one, so a debut winner does not
    // make a soft field read as stacked.
    const proven = E.filter((e) => e.wins >= 1 && e.racesRun >= 2);

    let field: string;
    if (sharks.length) field = `Sharp field: ${sharks.length} shark${sharks.length > 1 ? "s" : ""}${inForm.length ? ` and ${inForm.length} in form` : ""}`;
    else if (inForm.length) field = `Live field: ${inForm.length} in form`;
    else if (proven.length === 0) field = "Soft field: no proven winners";
    else field = `${proven.length} proven winner${proven.length > 1 ? "s" : ""} in the field`;
    if (topElo != null) field += `, top ELO ${Math.round(topElo)}`;
    field += ".";

    const timing = w.racesRun <= 1 ? "first time out" : "";
    let quality = "";
    if (race.trackLength != null && w.bestDistance === race.trackLength) quality = "with the distance on its side";
    else if (w.isShark) quality = "as the field's shark";
    else if (topElo != null && w.elo != null && w.elo === topElo) quality = "as the class of the field";
    else if (w.rawWinRate != null && w.racesRun >= 5 && w.rawWinRate >= 0.15) quality = `a ${formatPct(w.rawWinRate, 0)} career winner`;
    const tail = [timing, quality].filter(Boolean).join(" ");
    return { field, winnerTail: ` took it${tail ? " " + tail : ""}.`, trap: race.verdict?.payoutTrap ?? false };
  }
  const rd = winner ? buildReadout(winner) : null;

  // Margins from real finish times: each chaser's gap to the winner, 2nd through 4th.
  const winTime = winner?.timeMs ?? null;
  const margins = winTime != null
    ? order.slice(1, 4)
        .filter((e) => e.timeMs != null && e.finishPosition != null)
        .map((e) => `${ordinal(e.finishPosition!)} +${((e.timeMs! - winTime) / 1000).toFixed(2)}s`)
    : [];
  // How our pre-race call held up, in one terse line (kept, it is the honesty).
  const modelCall = !winner ? "" : favoriteHit
    ? `Model called it: our favorite ${favName(favorite)} went off on top and delivered.`
    : `Upset: our favorite ${favName(favorite)} finished ${favorite?.finishPosition ? ordinal(favorite.finishPosition) : "off the board"}${winnerPred ? `, the winner was our ${ordinal(winnerPred.rank)} pick` : ""}.`;

  return (
    <div className="space-y-5">
      {/* Patch-notes recap: built only from finish order, times, margins, and our call.
          No motion or splits, that data does not exist. */}
      {winner && (
        <div className="rounded-lg border p-4" style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 8%, transparent)` }}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="type-micro uppercase tracking-wider" style={{ color: accent }}>Race recap</p>
            <a
              href={GIGA_RACING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="type-micro uppercase tracking-wider rounded-md border px-2.5 py-1 transition-paddock hover:border-glow hover:text-glow"
              style={{ borderColor: "var(--line-strong)", color: "var(--ink-soft)" }}
            >
              Open Racing on Gigaverse ↗
            </a>
          </div>
          <p className="type-card-title mt-1 text-ink">
            <Link href={`/pet/${winner.petId}`} className="transition-paddock hover:text-glow">{winner.name ?? `#${winner.petId}`}</Link> wins{winTime != null ? ` in ${fmtSec(winTime, 3)}` : ""}.
          </p>
          <ul className="mt-2 space-y-1">
            {rd && <RecapLine>{rd.field}</RecapLine>}
            {rd && (
              <RecapLine>
                <Link href={`/pet/${winner.petId}`} className="text-ink-soft transition-paddock hover:text-glow">{winner.name ?? `#${winner.petId}`}</Link>
                {rd.winnerTail}
              </RecapLine>
            )}
            {margins.length > 0 && <RecapLine>Margins: {margins.join(", ")}.</RecapLine>}
            {rd?.trap && <RecapLine tone="gold">Payout trap: the board flagged a thin payout split.</RecapLine>}
            {modelCall && <RecapLine>{modelCall}</RecapLine>}
          </ul>
          <p className="type-micro mt-3 normal-case text-ink-faint">
            Model track record on the{" "}
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
                    {e.timeMs != null ? ` · ${e.finishPosition === 1 || winTime == null ? fmtSec(e.timeMs, 3) : `+${((e.timeMs - winTime) / 1000).toFixed(2)}s`}` : ""}
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
