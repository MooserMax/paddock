import type { CalibrationBucket } from "@/lib/api/types";

// The signature visual for this page: predicted probability (x) against actual
// win frequency (y), with the perfect-calibration diagonal. Points on the line
// are honest; points below the line are overconfident. The gap IS the message.
export default function CalibrationChart({ buckets }: { buckets: CalibrationBucket[] }) {
  const SIZE = 320;
  const PAD = 36;
  const plot = SIZE - PAD * 2;
  const x = (p: number) => PAD + p * plot;
  const y = (p: number) => SIZE - PAD - p * plot;
  const r = (count: number) => Math.max(3, Math.min(11, Math.sqrt(count) / 4));

  const points = buckets.map((b) => ({ px: x(b.predictedMean), py: y(b.actualFreq), b }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label="Calibration plot: predicted probability versus actual win frequency">
      {/* grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={x(g)} y1={y(0)} x2={x(g)} y2={y(1)} stroke="var(--line)" strokeWidth={0.5} />
          <line x1={x(0)} y1={y(g)} x2={x(1)} y2={y(g)} stroke="var(--line)" strokeWidth={0.5} />
          <text x={x(g)} y={SIZE - PAD + 14} textAnchor="middle" className="mono" fontSize={8} fill="var(--ink-faint)">{g * 100}</text>
          <text x={PAD - 8} y={y(g) + 3} textAnchor="end" className="mono" fontSize={8} fill="var(--ink-faint)">{g * 100}</text>
        </g>
      ))}

      {/* perfect-calibration diagonal */}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--ink-faint)" strokeWidth={1} strokeDasharray="3 3" />
      <text x={x(0.72)} y={y(0.72) - 6} className="mono" fontSize={8} fill="var(--ink-faint)" transform={`rotate(-45 ${x(0.72)} ${y(0.72)})`}>perfect calibration</text>

      {/* model curve */}
      <path d={path} fill="none" stroke="var(--glow)" strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={p.px} cy={p.py} r={r(p.b.count)} fill="var(--glow)" fillOpacity={0.7} stroke="var(--glow)" />
      ))}

      {/* axis titles */}
      <text x={SIZE / 2} y={SIZE - 4} textAnchor="middle" className="mono" fontSize={9} fill="var(--ink-soft)">predicted win probability (%)</text>
      <text x={12} y={SIZE / 2} textAnchor="middle" className="mono" fontSize={9} fill="var(--ink-soft)" transform={`rotate(-90 12 ${SIZE / 2})`}>actual win frequency (%)</text>
    </svg>
  );
}
