import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api/client";
import type { CalibrationResult } from "@/lib/api/types";
import Panel from "@/components/ui/Panel";
import CalibrationChart from "@/components/calibration/CalibrationChart";
import { formatInt, formatPct, timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Odds calibration",
  description: "The odds model grades itself out of sample. A walk-forward backtest with a temporal split, showing where the model is honest and where it is overconfident.",
};

export const revalidate = 600;

export default async function CalibrationPage() {
  let cal: CalibrationResult | null = null;
  try {
    cal = await api.calibration();
  } catch {
    // rendered as the not-yet-computed state below
  }

  if (!cal) {
    return (
      <div className="mx-auto max-w-page px-4 py-16 md:px-6">
        <Panel eyebrow="Odds calibration" title="Not computed yet">
          <p className="type-body text-ink-soft">The backtest has not run yet. Check back shortly.</p>
        </Panel>
      </div>
    );
  }

  const m = cal.metrics;
  const skill = (1 - m.brier / m.baselineBrier) * 100; // Brier skill score vs uniform

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6 max-w-2xl">
        <p className="eyebrow">A probability product, not a betting product</p>
        <h1 className="type-page-title mt-2 text-ink">The model grades itself</h1>
        <p className="type-body mt-3 text-ink-soft">
          Every probability the odds model would have produced, scored against what actually happened. Out of sample, walk-forward, with a temporal split. When the model is wrong, this page shows it. Keeping score in public is the point.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel eyebrow="Held-out calibration" title="Predicted vs actual" note="Each point is a probability decile on the held-out races. On the dashed line is perfect; below it is overconfident.">
          <CalibrationChart buckets={cal.buckets} />
        </Panel>

        <div className="space-y-6">
          <Panel eyebrow="The honest read" title="Well-calibrated low, overconfident high">
            <p className="type-body text-ink-soft">
              Below 50% predicted, the model is well-calibrated: when it says 24%, horses win 26%. Above 50% it is overconfident: when it says 84%, horses win 58%. Strong prior records overstate certainty in a noisy sport. Narrowing that high-end gap is v2&apos;s job, and it is stated here rather than hidden.
            </p>
          </Panel>

          <Panel eyebrow="Scores on held-out races" title="">
            <dl className="grid grid-cols-2 gap-4">
              <Metric label="Brier score" value={m.brier.toFixed(3)} sub={`vs ${m.baselineBrier.toFixed(3)} uniform`} />
              <Metric label="Brier skill" value={`${skill.toFixed(0)}%`} sub="better than guessing" accent="var(--green)" />
              <Metric label="Log loss" value={m.logLoss.toFixed(3)} sub="lower is better" />
              <Metric label="Held-out entries" value={formatInt(m.heldOutEntries)} sub={`${formatInt(cal.split.testRaces)} races`} />
            </dl>
          </Panel>
        </div>
      </div>

      <Panel eyebrow="The split, stated" title="How this avoids grading itself on its own training data" className="mt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <p className="type-body text-ink-soft">
            Races run in time order. The model fits its one parameter on the earlier {formatInt(cal.split.trainRaces)} races (before race #{formatInt(cal.split.cutoffRaceId)}) and is scored only on the later {formatInt(cal.split.testRaces)} held-out races. Every prediction uses a horse&apos;s record from races strictly before the one being predicted, so the outcome is never an input. Method: {cal.split.method}.
          </p>
          <div className="rounded-md border p-4" style={{ borderColor: "var(--line)" }}>
            <p className="eyebrow mb-1">Scope</p>
            <p className="type-micro normal-case leading-relaxed text-ink-faint">{cal.scope}</p>
          </div>
        </div>
      </Panel>

      <p className="type-micro mt-6 normal-case text-ink-faint">
        Model {cal.modelVersion}. Backtest computed {timeAgo(cal.generatedAt)}, served precomputed by{" "}
        <Link href="/api/v1/calibration" className="underline transition-paddock hover:text-glow">/api/v1/calibration</Link>. Held-out field baseline win rate {formatPct(m.fieldBaselineWinRate, 1)}.
      </p>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div>
      <dt className="type-micro uppercase text-ink-faint">{label}</dt>
      <dd className="type-section mt-0.5 tabular-nums" style={{ color: accent ?? "var(--ink)" }}>{value}</dd>
      <dd className="type-micro normal-case text-ink-faint">{sub}</dd>
    </div>
  );
}
