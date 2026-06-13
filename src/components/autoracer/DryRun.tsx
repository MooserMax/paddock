"use client";

import { useState } from "react";

interface SafetyCheck { name: string; pass: boolean; detail: string }
interface Result {
  intent: { to: string; data: string; value: string };
  safety: { safe: boolean; reason: string | null; checks: SafetyCheck[] };
  simulated: { attempted: boolean; reverted: boolean; error: string | null };
  signed: boolean;
}

export default function DryRun() {
  const [race, setRace] = useState("5667");
  const [pet, setPet] = useState("6249");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(r = race, p = pet) {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/autoracer/simulate?race=${r}&pet=${p}`);
      setResult(await res.json());
    } catch {
      // surfaced as no result
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Race id" value={race} onChange={setRace} />
        <Field label="Your pet id" value={pet} onChange={setPet} />
        <button
          type="button"
          onClick={() => run()}
          disabled={loading}
          className="transition-paddock rounded-md px-5 py-2.5"
          style={{ background: "var(--action)", color: "#14110f", opacity: loading ? 0.6 : 1 }}
        >
          <span className="type-data">{loading ? "Simulating" : "Dry run, never signs"}</span>
        </button>
      </div>

      {result && (
        <div className="mt-5 space-y-4">
          {/* The transaction it WOULD build */}
          <div className="rounded-md border hairline p-4">
            <p className="eyebrow mb-2">The transaction it would build</p>
            <dl className="space-y-1.5">
              <KV k="to" v={result.intent.to} />
              <KV k="value" v={`${result.intent.value} wei`} accent={result.intent.value === "0" ? "var(--green)" : "var(--brick)"} />
              <KV k="calldata" v={`${result.intent.data.slice(0, 42)}...`} />
            </dl>
          </div>

          {/* Safety checks */}
          <div className="rounded-md border p-4" style={{ borderColor: result.safety.safe ? "var(--green)" : "var(--brick)" }}>
            <p className="eyebrow mb-2">Safety guard</p>
            <ul className="space-y-1.5">
              {result.safety.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2">
                  <span style={{ color: c.pass ? "var(--green)" : "var(--brick)" }}>{c.pass ? "✓" : "✕"}</span>
                  <span className="type-data text-ink-soft">
                    {c.name}
                    <span className="type-micro ml-2 normal-case text-ink-faint">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Simulation outcome */}
          <div className="rounded-md border hairline p-4">
            <p className="eyebrow mb-2">Read-only simulation (eth_call)</p>
            {result.simulated.reverted ? (
              <p className="type-data text-ink-soft">
                Would revert: <span className="text-ink-faint">{result.simulated.error}</span>. That is a state issue (race closed, full, or you do not own this pet), not a safety failure.
              </p>
            ) : result.simulated.attempted ? (
              <p className="type-data" style={{ color: "var(--green)" }}>Simulation succeeded. The entry would be accepted.</p>
            ) : (
              <p className="type-data text-ink-soft">Not simulated: the safety guard refused this transaction first.</p>
            )}
            <p className="type-micro mt-2 normal-case text-ink-faint">Signed: {String(result.signed)}. Nothing was broadcast.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1">
      <label className="type-micro block uppercase text-ink-faint">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="type-data mt-1 w-full rounded-md border bg-transparent px-3 py-2.5 text-ink outline-none transition-paddock focus-visible:border-glow"
        style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
      />
    </div>
  );
}

function KV({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-micro uppercase text-ink-faint">{k}</dt>
      <dd className="type-data break-all text-right tabular-nums" style={{ color: accent ?? "var(--ink-soft)" }}>{v}</dd>
    </div>
  );
}
