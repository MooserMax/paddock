import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { CalibrationResult } from "@/lib/api/types";
import Panel from "@/components/ui/Panel";

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

export default async function MethodologyPage() {
  let cal: CalibrationResult | null = null;
  try {
    cal = await api.calibration();
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
          The scoring weights come from a study of every resolved race at the time: 4,537 races, 30,288 entries. The strongest single signal is raw stat quality: race winners average 3.8% above the field on all four stats. Among traits, Surger is the alpha: a 23.19% win rate when active versus a 14.18% baseline, a 1.63x lift. Volatile actively hurts, at 0.81x. Several traits change sign by distance, which is why track fit is computed per length rather than globally. Closer&apos;s edge, for example, appears only at 2400m and longer.
        </p>
      </Section>

      <Section title="Confirmed quality, upside, and shrinkage" eyebrow="The two numbers">
        <p>
          Confirmed quality uses only revealed information: revealed stat values, revealed trait star levels weighted by their study lift, and an actual win rate. Upside is the opposite: for unrevealed horses it reads rarity, the traits a horse carries from birth, and races remaining, and it is labeled potential, never proof. Win rate everywhere is Bayesian-shrunk toward the 14.9% population baseline, so a 2-for-3 horse does not outrank a 20-for-60 horse on three lucky races. The raw record is always shown beside the shrunk number.
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
              Flagged horses (at 0.30) win 50.9% of their next races versus a 14.9% baseline. Predictive, not cosmetic; the smooth gradient is the signature of real signal.
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

      <Section title="Valuation, and when we stay quiet" eyebrow="Comps or silence">
        <p>
          A valuation band is the interquartile range of comparable sales: same rarity, similar confirmed quality, similar reveal state. Below 3 comparable sales we show no band at all and say the comps are thin. Between 3 and 4 comps we show the band but flag it low-confidence. We never manufacture a precise number from a market that is too quiet to support one.
        </p>
      </Section>

      <Section title="What cannot be known" eyebrow="The honest gap">
        <p>
          Two things matter for racing that no public endpoint exposes. First, daily readiness: a horse has a daily race cap and becomes exhausted, but the public cooldown field reads 0 even for an exhausted horse, so Paddock cannot claim live readiness and does not. Second, point-in-time history: our data holds current ELO and current stat reveals, not their values on past dates, which is exactly why the odds backtest excludes them. Including current values to grade past races would leak the outcome. The scanner states this limit on every verdict.
        </p>
      </Section>

      <Section title="Your assets never move" eyebrow="Safety">
        <p>
          Paddock&apos;s read surfaces never touch a wallet. The optional auto-racer signs exactly one kind of transaction, a zero-value free-race entry, and the racing contract only reads ownership: it never transfers a Gigling and never needs an approval. This is proven on-chain, not asserted, with a committed analysis and a re-runnable forensics harness. The full write-up is in SECURITY.md in the repository.
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
