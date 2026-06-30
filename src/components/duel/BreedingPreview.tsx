"use client";

import { useState } from "react";

interface Outcome<T> { status: string; value?: T; note: string }
interface Stats { start: number; speed: number; stamina: number; finish: number }
interface Preview {
  valid: { ok: boolean; errors: string[]; warnings: string[] };
  certain: { generation: number | null; generationBonus: number | null; genderRule: string; forcedFallen: number | null };
  odds: { faction: Outcome<string>; expectedStats: Outcome<Stats> };
  pending: string[];
  glue: { a: { deglueYield: number | null; reglueCost: number | null }; b: { deglueYield: number | null; reglueCost: number | null } };
}
interface Parent { petId: number; sex: string | null; rarity: string | null; generation: number | null; factionName: string | null; racesRun: number | null; duelsLeft: number | null }
interface Result { a: Parent; b: Parent; preview: Preview }

function Block({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border hairline p-4">
      <p className="type-micro mb-2 uppercase tracking-wider" style={{ color: tone }}>{label}</p>
      {children}
    </div>
  );
}

export default function BreedingPreview() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    const na = Number(a), nb = Number(b);
    if (!Number.isInteger(na) || !Number.isInteger(nb) || na <= 0 || nb <= 0) { setErr("Enter two Gigling ids."); return; }
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/duel/preview?a=${na}&b=${nb}`);
      if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Preview failed.");
      setRes(await r.json());
    } catch (e) { setErr(e instanceof Error ? e.message : "Preview failed."); setRes(null); }
    finally { setLoading(false); }
  }

  const p = res?.preview;
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="mb-4 flex flex-wrap gap-2">
        <input value={a} onChange={(e) => setA(e.target.value)} placeholder="Gigling A id" inputMode="numeric"
          className="type-data w-36 rounded-md border hairline bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-faint" />
        <input value={b} onChange={(e) => setB(e.target.value)} placeholder="Gigling B id" inputMode="numeric"
          className="type-data w-36 rounded-md border hairline bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-faint" />
        <button type="submit" className="transition-paddock rounded-md border hairline px-4 py-2 type-micro uppercase tracking-wider text-ink-soft hover:text-ink hover:border-line-strong">Preview</button>
      </form>
      {err && <p className="type-micro mb-3 normal-case" style={{ color: "var(--brick)" }}>{err}</p>}
      {loading && <p className="type-data text-ink-faint">Reading the pairing...</p>}

      {res && p && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            {[res.a, res.b].map((par) => (
              <p key={par.petId} className="type-data text-ink-soft">
                <span className="text-ink">#{par.petId}</span> {par.sex ?? "?"} · {par.rarity ?? "?"} · gen {par.generation ?? "?"} · {par.factionName ?? "Factionless"} · {par.racesRun ?? 0} races · {par.duelsLeft ?? "?"} duels
              </p>
            ))}
          </div>

          {/* Validation */}
          {!p.valid.ok && (
            <Block label="Cannot duel" tone="var(--brick)">
              {p.valid.errors.map((e, i) => <p key={i} className="type-data text-ink">{e}</p>)}
            </Block>
          )}
          {p.valid.warnings.map((w, i) => (
            <Block key={i} label="Warning" tone="var(--brick)"><p className="type-data text-ink">{w}</p></Block>
          ))}

          {/* Certain */}
          <Block label="Certain" tone="var(--green)">
            <p className="type-data text-ink">
              Duelborn generation: <span style={{ color: "var(--gold)" }}>{p.certain.generation ?? "?"}</span>
              {p.certain.generationBonus != null && <span className="text-ink-soft"> (+{p.certain.generationBonus} flat Start/Speed/Finish)</span>}
            </p>
            <p className="type-data mt-1 text-ink-soft">{p.certain.genderRule}</p>
          </Block>

          {/* Odds / known math */}
          <Block label="Odds, known math (not guarantees)" tone="var(--cyan)">
            <p className="type-data text-ink">Faction: <span className="text-ink-soft">{p.odds.faction.note}</span></p>
            {p.odds.expectedStats.value && (
              <p className="type-data mt-2 text-ink">
                Expected stats (midpoint): <span style={{ color: "var(--gold)" }}>
                  S {p.odds.expectedStats.value.start} · Sp {p.odds.expectedStats.value.speed} · St {p.odds.expectedStats.value.stamina} · F {p.odds.expectedStats.value.finish}
                </span>
              </p>
            )}
            <p className="type-micro mt-1 normal-case text-ink-faint">{p.odds.expectedStats.note}</p>
          </Block>

          {/* Glue */}
          <Block label="Glue economy" tone="var(--ink-faint)">
            <p className="type-data text-ink-soft">
              #{res.a.petId} deglue yields {p.glue.a.deglueYield ?? "?"} glue / reglue costs {p.glue.a.reglueCost ?? "?"}; #{res.b.petId} yields {p.glue.b.deglueYield ?? "?"} / costs {p.glue.b.reglueCost ?? "?"}.
            </p>
          </Block>

          {/* Pending */}
          <Block label="Coming with the odds model" tone="var(--ink-faint)">
            <ul className="space-y-1">
              {p.pending.map((x, i) => <li key={i} className="type-data text-ink-faint">{x}</li>)}
            </ul>
          </Block>
        </div>
      )}
    </div>
  );
}
