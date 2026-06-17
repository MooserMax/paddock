import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { CalibrationResult } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How Paddock knows what it knows: the honest-data principle, the study behind the scores, and the out-of-sample validation of every threshold and model.",
};

export const revalidate = 600;

const SHARK_TABLE = [
  { t: "0.25", n: 1504, wr: "45.7%", lift: "3.06x" },
  { t: "0.28", n: 798, wr: "48.6%", lift: "3.26x" },
  { t: "0.30", n: 517, wr: "50.9%", lift: "3.41x", current: true },
  { t: "0.33", n: 256, wr: "53.5%", lift: "3.59x" },
  { t: "0.35", n: 141, wr: "55.3%", lift: "3.71x" },
];

// Distance-fit validation (scripts/study-distance-fit.mts), 8,398 resolved races,
// 55,683 entries. Finish percentile: 0 is first, 1 is last (lower is better).
const FIT_GRADIENT = [
  { band: "Lowest fit decile (~24)", pctile: "0.68" },
  { band: "Middle decile (~50)", pctile: "0.53" },
  { band: "Highest fit decile (~73)", pctile: "0.38" },
];
const FIT_PENALTY = [
  { gap: "At or near best (< 3)", pen: "-0.007", read: "no harm" },
  { gap: "5 to 10 below", pen: "+0.004", read: "modest" },
  { gap: "15 to 20 below", pen: "+0.009", read: "material", current: true },
  { gap: "20+ below", pen: "+0.009", read: "material" },
];

export default async function MethodologyPage() {
  let cal: CalibrationResult | null = null;
  let resolvedNow: number | null = null;
  try {
    const [c, stats] = await Promise.all([api.calibration(), api.stats()]);
    cal = c;
    resolvedNow = stats.racesResolved;
  } catch {
    // the integrity section degrades gracefully without the live numbers
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8">
        <p className="eyebrow">Methodology</p>
        <h1 className="type-page-title mt-2 text-ink">How Paddock knows what it knows</h1>
        <p className="type-body mt-3 text-ink-soft">
          One engine produces every number on this site. This page is the audit trail: what we measure, what we will not pretend to measure, and how every threshold and model was checked against real outcomes rather than asserted.
        </p>
      </header>

      <Section title="The honest-data principle" eyebrow="First, what we will not do">
        <p>
          A Gigling&apos;s four stats are hidden, shown only as min-max ranges that narrow as the horse races. Paddock never collapses an unrevealed range into a single number. A horse showing 50 to 100 has an unknown stat; its midpoint is not information. Every value on the site is one of three things: a true revealed value, an explicit range with its reveal percentage, or an estimate clearly labeled with its method. When something cannot be known, the interface says so.
        </p>
      </Section>

      <Section title="The study behind the scores" eyebrow="A full-population read">
        <p>
          The scoring weights come from a study of every resolved race at the time: 4,537 races, 30,288 entries. The weights are frozen from that snapshot, so the constants stay fixed even as live data grows ({resolvedNow ? `now past ${resolvedNow.toLocaleString("en-US")} resolved races` : "the live count keeps climbing"}); 4,537 is the studied population, not a stale count. The strongest single signal is raw stat quality: race winners average 3.8% above the field on all four stats. Among traits, Surger is the alpha: a 23.19% win rate when active versus the study&apos;s 14.18% baseline, a 1.63x lift overall. Several traits change sign by distance, which is why track fit is computed per length rather than globally: Surger is 1.63x across all tracks but 1.69x at 1200m, and Closer&apos;s edge appears only at 2400m and longer.
        </p>
      </Section>

      <Section title="Confirmed quality, upside, and shrinkage" eyebrow="The two numbers">
        <p>
          Confirmed quality uses only revealed information: revealed stat values, revealed trait star levels weighted by their study lift, and an actual win rate. Upside is the opposite: for unrevealed horses it reads rarity, the traits a horse carries from birth, and races remaining, and it is labeled potential, never proof. Win rate everywhere is Bayesian-shrunk toward the study&apos;s 14.18% baseline, the same rate the study measured, so a 2-for-3 horse does not outrank a 20-for-60 horse on three lucky races. The raw record is always shown beside the shrunk number.
        </p>
      </Section>

      <Section title="Validated out of sample, everywhere" eyebrow="The part that is hard to fake">
        <p>
          A threshold that is merely rare is not the same as a threshold that is predictive. So both the scanner&apos;s shark flag and the odds model were checked the same disciplined way: walk the races in time order, judge each horse only on its record from races strictly before the one being scored, and measure what actually happened next. The outcome is never an input to the prediction.
        </p>

        <div className="my-5 grid gap-4 md:grid-cols-2">
          <div className="panel p-4">
            <p className="eyebrow mb-2">Scanner shark flag, out of sample</p>
            <table className="w-full">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className="type-micro pb-1 uppercase text-ink-faint">Line</th>
                  <th className="type-micro pb-1 text-right uppercase text-ink-faint">Win rate</th>
                  <th className="type-micro pb-1 text-right uppercase text-ink-faint">Lift</th>
                </tr>
              </thead>
              <tbody>
                {SHARK_TABLE.map((r) => (
                  <tr key={r.t} style={r.current ? { background: "color-mix(in srgb, var(--brick) 12%, transparent)" } : undefined}>
                    <td className="type-data py-1 tabular-nums text-ink">{r.t}{r.current ? " ★" : ""}</td>
                    <td className="type-data py-1 text-right tabular-nums text-ink-soft">{r.wr}</td>
                    <td className="type-data py-1 text-right tabular-nums" style={{ color: "var(--green)" }}>{r.lift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="type-micro mt-2 normal-case text-ink-faint">
              Flagged horses (at 0.30) win 50.9% of their next races versus the full-entry 14.9% baseline (the win rate across all finished entries, distinct from the study&apos;s 14.18%). Predictive, not cosmetic; the smooth gradient is the signature of real signal.
            </p>
          </div>

          <div className="panel p-4">
            <p className="eyebrow mb-2">Odds model, held-out calibration</p>
            {cal ? (
              <dl className="space-y-1.5">
                <Row k="Brier score" v={`${cal.metrics.brier.toFixed(3)} vs ${cal.metrics.baselineBrier.toFixed(3)} uniform`} />
                <Row k="Brier skill" v={`${((1 - cal.metrics.brier / cal.metrics.baselineBrier) * 100).toFixed(0)}% better than guessing`} />
                <Row k="Split" v={`${cal.split.trainRaces} train / ${cal.split.testRaces} held out`} />
              </dl>
            ) : (
              <p className="type-data text-ink-faint">See the calibration page.</p>
            )}
            <p className="type-micro mt-2 normal-case text-ink-faint">
              Well-calibrated below 50%, overconfident above. Shown, not hidden, on the{" "}
              <Link href="/calibration" className="underline transition-paddock hover:text-glow">calibration page</Link>.
            </p>
          </div>
        </div>

        <p>
          These two findings are one story. The odds model is overconfident on its favorites: when it says 84%, those horses win about 58%. Its high-confidence picks, averaging a 69% predicted chance, actually win 52%. That is the same number the shark cohort wins, near 50%. Whether you define a strong horse relatively, as the model&apos;s favorite, or absolutely, as a shark, the truth is identical: elite Giglings are strong but beatable, and a naive favorite-take overstates them. The scanner and the odds model show the same reality from two angles.
        </p>
      </Section>

      <Section title="Distance fit, validated the same way" eyebrow="Real, but modest, and we say so">
        <p>
          Distance fit used to sit in the &quot;what we know&quot; list on assertion alone. It now earns the same out-of-sample table as the shark flag and the odds model, over 8,398 resolved races and 55,683 entries (reproducible from scripts/study-distance-fit.mts). Fit is outcome-independent (it reads only revealed stats and traits, never wins, ELO, or finish), so unlike ELO it cannot leak the result; the relationship even strengthens as a horse&apos;s stats reveal more, which is the signature of a real effect rather than an artifact.
        </p>

        <div className="my-5 grid gap-4 md:grid-cols-2">
          <div className="panel p-4">
            <p className="eyebrow mb-2">Raw gradient: higher fit, better finish</p>
            <table className="w-full">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className="type-micro pb-1 uppercase text-ink-faint">Fit at the track</th>
                  <th className="type-micro pb-1 text-right uppercase text-ink-faint">Mean finish pctile</th>
                </tr>
              </thead>
              <tbody>
                {FIT_GRADIENT.map((r) => (
                  <tr key={r.band}>
                    <td className="type-data py-1 text-ink">{r.band}</td>
                    <td className="type-data py-1 text-right tabular-nums text-ink-soft">{r.pctile}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="type-micro mt-2 normal-case text-ink-faint">
              Monotonic across all ten deciles, Pearson r is -0.29 over the full set and -0.33 among the most-revealed horses. But most of this is horse quality: good horses carry high fit at every distance and finish well everywhere, so this raw link overstates fit&apos;s own contribution.
            </p>
          </div>

          <div className="panel p-4">
            <p className="eyebrow mb-2">Within-horse, quality-controlled penalty</p>
            <table className="w-full">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className="type-micro pb-1 uppercase text-ink-faint">Fit pts below own best</th>
                  <th className="type-micro pb-1 text-right uppercase text-ink-faint">Finish penalty</th>
                </tr>
              </thead>
              <tbody>
                {FIT_PENALTY.map((r) => (
                  <tr key={r.gap} style={r.current ? { background: "color-mix(in srgb, var(--gold) 12%, transparent)" } : undefined}>
                    <td className="type-data py-1 text-ink">{r.gap}{r.current ? " ★" : ""}</td>
                    <td className="type-data py-1 text-right tabular-nums" style={{ color: r.pen.startsWith("+") ? "var(--gold)" : "var(--green)" }}>{r.pen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="type-micro mt-2 normal-case text-ink-faint">
              Each race scored against the same horse&apos;s mean across its other races (leave-one-out), so horse quality is removed and a race never baselines on its own outcome. The honest, isolated effect of distance fit: real and monotonic, but small, roughly a tenth of a finishing position end to end. It firms up (+0.009) at 15 points below best, which is exactly where the scanner&apos;s weak-fit caution begins.
            </p>
          </div>
        </div>

        <p>
          So the scanner treats fit as a heads-up, not a stop sign. Below 3 points off a horse&apos;s own best is within noise and says nothing. From 3 to 15 points is a quiet &quot;off best&quot; note. Only at 15 points or more below best, and only when that gap is at least half the horse&apos;s own fit spread, does it raise a soft caution. The thresholds are these numbers, not hand-picked examples.
        </p>
      </Section>

      <Section title="Valuation, and when we stay quiet" eyebrow="Comps or silence">
        <p>
          A valuation band is the interquartile range of comparable sales: same rarity, similar confirmed quality, similar reveal state. Below 3 comparable sales we show no band at all and say the comps are thin. Between 3 and 4 comps we show the band but flag it low-confidence. We never manufacture a precise number from a market that is too quiet to support one.
        </p>
      </Section>

      <Section title="What cannot be known" eyebrow="The honest gap">
        <p>
          Paddock is the source of truth for what is knowable and persistent about a horse: its revealed stats and ranges, traits and tiers, study-measured lifts, confirmed quality and upside, distance fit, and its win rate and ELO from the actual on-chain record. Three things, by contrast, no pre-race tool can see. We name them rather than pretend otherwise.
        </p>
        <p>
          First, daily readiness. A horse has a daily race cap and becomes exhausted, but the public cooldown field reads 0 even for an exhausted horse, so Paddock cannot claim live readiness and does not.
        </p>
        <p>
          Second, point-in-time history. Our data holds current ELO and current stat reveals, not their values on past dates, which is exactly why the odds backtest excludes them. Including current values to grade past races would leak the outcome. The scanner states this limit on every verdict.
        </p>
        <p>
          Third, and most significant: items and sabotage. Players can spend consumables mid-race: butterflies that add 5 to 10 percent speed to their own horse, dung that takes 5 to 10 percent off a rival, each lasting five seconds, with faction-matched versions hitting harder. Only one item applies per play and it fires at the next resolve interval, so the effect is a series of timed nudges, not a permanent multiplier. But these are decided in real time by other players during the race, are not recorded on-chain, and leave no trace Paddock can read, before or after. Paddock does not model them. The scores describe the race that horse quality and distance fit would produce; item play is a layer of live human agency on top of that, invisible to any pre-race analysis. This is also why a horse&apos;s win rate is noisier than pure ability: its record already silently includes races where items swung the result.
        </p>
      </Section>

      <Section title="Your assets never move" eyebrow="Safety">
        <p>
          Paddock&apos;s read surfaces never touch a wallet. The optional{" "}
          <Link href="/auto-racer" className="underline transition-paddock hover:text-glow">auto-racer</Link>{" "}
          signs exactly one kind of transaction, a zero-value free-race entry, and the racing contract only reads ownership: it never transfers a Gigling and never needs an approval. This is proven on-chain, not asserted, with a committed analysis, a re-runnable forensics harness, and a signer-rejection test that holds the safety guard to account. The full write-up is in SECURITY.md in the repository.
        </p>
      </Section>

      <p className="type-micro mt-10 normal-case text-ink-faint">
        Every figure here is reproducible from the public API and the scripts in the repository. The model grades itself in public on the{" "}
        <Link href="/calibration" className="underline transition-paddock hover:text-glow">calibration page</Link>.
      </p>
    </div>
  );
}

function Section({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section className="border-t hairline py-6 first:border-0">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="type-section mt-1 text-ink">{title}</h2>
      <div className="type-body mt-3 space-y-3 text-ink-soft">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-micro uppercase text-ink-faint">{k}</dt>
      <dd className="type-data text-right tabular-nums text-ink">{v}</dd>
    </div>
  );
}
