"use client";

import { useState } from "react";
import Link from "next/link";
import { DEMO_WALLET } from "@/components/WalletSearch";

interface RadarPet { petId: number; name: string | null; sex: string | null; racesRun: number; racesToGo: number; status: string; duelsLeft: number | null; rarity: string | null }
interface Radar { eligibleMales: RadarPet[]; eligibleFemales: RadarPet[]; approaching: RadarPet[]; danger: RadarPet[]; counts: { eligible: number; approaching: number; danger: number; total: number } }

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
interface RarityDist { rarity: number; name: string; pct: number }
interface Modeled {
  modelN: number;
  rarity: { distribution: RarityDist[]; mostLikely: number; n: number; basis: string };
  faction: { inheritRatePct: number; n: number } | null;
  fall: { rule: string; n: number };
  valuation: { burnedEth: number | null; burnedSource: string; gainedEth: number | null; gainedN: number; netEth: number | null; note: string };
  caveat: string;
}
interface PreviewResult { a: Parent; b: Parent; preview: Preview; modeled: Modeled | null }
interface Suggestion {
  male: { petId: number; name: string | null; rarity: string | null };
  female: { petId: number; name: string | null; rarity: string | null };
  predictedRarity: { name: string; pct: number; n: number; basis: string };
  upgradeChancePct: number;
  netEth: number | null;
}
interface BestPairings { suggestions: Suggestion[]; modelN: number; note: string }

const GIGA_DUEL_URL = "https://gigaverse.io/duel";
const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Relic", "Giga"];

function PetCard({ p, selected, onSelect }: { p: RadarPet; selected: boolean; onSelect: () => void }) {
  const danger = p.duelsLeft === 1;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="transition-paddock w-full rounded-lg border p-3 text-left hover:border-line-strong"
      style={{ borderColor: selected ? "var(--gold)" : danger ? "var(--brick)" : "var(--line)", background: selected ? "color-mix(in srgb, var(--gold) 8%, transparent)" : "transparent" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="type-data truncate text-ink">{p.name ?? `#${p.petId}`}</span>
        {danger && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>final duel</span>}
      </div>
      <div className="type-micro mt-1 normal-case text-ink-faint">
        {p.rarity ?? "?"} · {p.racesRun} races · {p.duelsLeft != null ? `${p.duelsLeft} duels left` : "duels: max"}
      </div>
    </button>
  );
}

function Block({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border hairline p-4">
      <p className="type-micro mb-2 uppercase tracking-wider" style={{ color: tone }}>{label}</p>
      {children}
    </div>
  );
}

export default function DuelStudio({ minRaces }: { minRaces: number }) {
  const [addr, setAddr] = useState("");
  const [radar, setRadar] = useState<Radar | null>(null);
  const [loadingR, setLoadingR] = useState(false);
  const [errR, setErrR] = useState<string | null>(null);

  const [male, setMale] = useState<number | null>(null);
  const [female, setFemale] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loadingP, setLoadingP] = useState(false);
  const [errP, setErrP] = useState<string | null>(null);

  const [best, setBest] = useState<BestPairings | null>(null);

  async function scan(a: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { setErrR("Paste a 0x wallet address."); return; }
    setLoadingR(true); setErrR(null); setMale(null); setFemale(null); setPreview(null); setBest(null);
    try {
      const r = await fetch(`/api/v1/duel/radar?address=${a}`);
      if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Lookup failed.");
      setRadar(await r.json());
      fetch(`/api/v1/duel/best-pairings?address=${a}`).then((x) => x.ok ? x.json() : null).then((b) => setBest(b)).catch(() => setBest(null));
    } catch (e) { setErrR(e instanceof Error ? e.message : "Lookup failed."); setRadar(null); }
    finally { setLoadingR(false); }
  }

  async function runPreview(a: number, b: number) {
    setLoadingP(true); setErrP(null);
    try {
      const r = await fetch(`/api/v1/duel/preview?a=${a}&b=${b}`);
      if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Preview failed.");
      setPreview(await r.json());
    } catch (e) { setErrP(e instanceof Error ? e.message : "Preview failed."); setPreview(null); }
    finally { setLoadingP(false); }
  }

  function pick(sex: "male" | "female", id: number) {
    const nm = sex === "male" ? male : female;
    const next = nm === id ? null : id;
    if (sex === "male") setMale(next); else setFemale(next);
    const m = sex === "male" ? next : male;
    const f = sex === "female" ? next : female;
    if (m && f) runPreview(m, f); else setPreview(null);
  }

  const p = preview?.preview;
  const doomedId = p?.certain.forcedFallen ?? null;
  const doomedParent = doomedId != null ? [preview?.a, preview?.b].find((x) => x?.petId === doomedId) : null;

  return (
    <div className="space-y-8">
      {/* A. HERO: your stable, ready to breed */}
      <div>
        <form onSubmit={(e) => { e.preventDefault(); scan(addr.trim()); }} className="flex flex-wrap gap-2">
          <input
            value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Paste a wallet to see who is ready to breed"
            className="type-data min-w-0 flex-1 rounded-md border hairline bg-transparent px-3.5 py-2.5 text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="submit" className="transition-paddock rounded-md border hairline px-5 py-2.5 type-micro uppercase tracking-wider text-ink-soft hover:text-ink hover:border-line-strong">Scan stable</button>
          <button type="button" onClick={() => { setAddr(DEMO_WALLET); scan(DEMO_WALLET); }} className="transition-paddock rounded-md px-3 py-2.5 type-micro uppercase tracking-wider text-ink-faint hover:text-ink">Demo</button>
        </form>
        {errR && <p className="type-micro mt-2 normal-case" style={{ color: "var(--brick)" }}>{errR}</p>}
        {loadingR && <p className="type-data mt-3 text-ink-faint">Reading the stable...</p>}

        {radar && (
          <div className="mt-5">
            <div className="mb-4 flex flex-wrap gap-4">
              <span className="type-micro uppercase tracking-wider" style={{ color: "var(--gold)" }}>{radar.counts.eligible} ready to breed</span>
              {radar.counts.danger > 0 && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>{radar.counts.danger} on a fatal final duel</span>}
              <span className="type-micro uppercase tracking-wider text-ink-faint">{radar.counts.approaching} approaching · {radar.counts.total} Giglings</span>
            </div>
            {radar.counts.eligible === 0 ? (
              <p className="type-data text-ink-faint">No Giglings with {minRaces}+ races and a free duel in this stable yet.</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="eyebrow mb-2">Eligible males ({radar.eligibleMales.length}) {male ? `· #${male} selected` : ""}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {radar.eligibleMales.slice(0, 12).map((pt) => <PetCard key={pt.petId} p={pt} selected={male === pt.petId} onSelect={() => pick("male", pt.petId)} />)}
                    {radar.eligibleMales.length === 0 && <p className="type-data text-ink-faint">None eligible.</p>}
                  </div>
                </div>
                <div>
                  <p className="eyebrow mb-2">Eligible females ({radar.eligibleFemales.length}) {female ? `· #${female} selected` : ""}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {radar.eligibleFemales.slice(0, 12).map((pt) => <PetCard key={pt.petId} p={pt} selected={female === pt.petId} onSelect={() => pick("female", pt.petId)} />)}
                    {radar.eligibleFemales.length === 0 && <p className="type-data text-ink-faint">None eligible.</p>}
                  </div>
                </div>
              </div>
            )}
            {radar.danger.length > 0 && (
              <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--brick)" }}>
                <p className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>Danger: fatal final duel</p>
                <p className="type-data mt-1 text-ink-soft">{radar.danger.map((d) => `#${d.petId}`).join(", ")} will be destroyed on their next duel (last duel left).</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Best pairings suggester */}
      {best && best.suggestions.length > 0 && (
        <div>
          <h2 className="type-section mb-1 text-ink">Best pairings for this stable</h2>
          <p className="type-micro mb-3 normal-case text-ink-faint">Ranked by expected net value. {best.note}</p>
          <div className="overflow-hidden rounded-lg border hairline">
            {best.suggestions.slice(0, 8).map((s, i) => (
              <button key={i} type="button"
                onClick={() => { setMale(s.male.petId); setFemale(s.female.petId); runPreview(s.male.petId, s.female.petId); }}
                className="transition-paddock flex w-full items-center gap-3 border-b hairline px-4 py-2.5 text-left last:border-0 hover:bg-paper-sunken">
                <span className="type-data w-6 tabular-nums text-ink-faint">{i + 1}</span>
                <span className="type-data flex-1 truncate text-ink">#{s.male.petId} {s.male.rarity ?? ""} <span className="text-ink-faint">x</span> #{s.female.petId} {s.female.rarity ?? ""}</span>
                <span className="type-data text-ink-soft">{s.predictedRarity.name} {s.predictedRarity.pct}%</span>
                <span className="type-data w-28 text-right tabular-nums" style={{ color: s.upgradeChancePct > 0 ? "var(--gold)" : "var(--ink-faint)" }}>{s.upgradeChancePct > 0 ? `${s.upgradeChancePct}% upgrade` : "holds tier"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* B. BREEDING PREVIEW centerpiece */}
      <div className="rounded-2xl border hairline p-5 md:p-6" style={{ background: "var(--paper-raised)" }}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="type-section text-ink">Breeding preview</h2>
          <div className="flex flex-wrap gap-2">
            <input value={male ?? ""} onChange={(e) => { const v = Number(e.target.value) || null; setMale(v); if (v && female) runPreview(v, female); }} placeholder="Male id" inputMode="numeric"
              className="type-data w-28 rounded-md border hairline bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-ink-faint" />
            <input value={female ?? ""} onChange={(e) => { const v = Number(e.target.value) || null; setFemale(v); if (v && male) runPreview(male, v); }} placeholder="Female id" inputMode="numeric"
              className="type-data w-28 rounded-md border hairline bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-ink-faint" />
          </div>
        </div>

        {!preview && !loadingP && <p className="type-data text-ink-faint">Pick one eligible male and one female above, or type two ids, to preview the Duelborn.</p>}
        {loadingP && <p className="type-data text-ink-faint">Reading the pairing...</p>}
        {errP && <p className="type-micro normal-case" style={{ color: "var(--brick)" }}>{errP}</p>}

        {preview && p && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              {[preview.a, preview.b].map((par) => (
                <p key={par.petId} className="type-data text-ink-soft">
                  <span className="text-ink">#{par.petId}</span> {par.sex ?? "?"} · {par.rarity ?? "?"} · gen {par.generation ?? "?"} · {par.factionName ?? "Factionless"} · {par.duelsLeft ?? "?"} duels
                </p>
              ))}
            </div>

            {!p.valid.ok && (
              <Block label="This pairing cannot duel" tone="var(--brick)">
                {p.valid.errors.map((e, i) => <p key={i} className="type-data text-ink">{e}</p>)}
              </Block>
            )}

            {/* WHO FALLS */}
            <Block label="Who falls" tone="var(--brick)">
              {doomedParent ? (
                <p className="type-data text-ink">
                  <span style={{ color: "var(--brick)" }}>#{doomedParent.petId}</span> will be <span style={{ color: "var(--brick)" }}>permanently destroyed</span> and become the Duelborn. CERTAIN: it is on its final duel.
                </p>
              ) : (
                <p className="type-data text-ink-soft">
                  Either parent can fall; the loser is decided by the duel outcome and Host Favour. The fall-probability model is in progress, so we do not claim which one yet.
                </p>
              )}
            </Block>

            {/* WHAT YOU GET */}
            <Block label="What you get" tone="var(--green)">
              <p className="type-data text-ink">
                Duelborn generation <span style={{ color: "var(--gold)" }}>{p.certain.generation ?? "?"}</span>
                {p.certain.generationBonus != null && <span className="text-ink-soft"> (+{p.certain.generationBonus} flat Start/Speed/Finish)</span>}
              </p>
              <p className="type-data mt-1 text-ink">
                Gender {doomedParent ? <span style={{ color: "var(--gold)" }}>{doomedParent.sex ?? "?"}</span> : "= the fallen parent's"}
                <span className="type-micro ml-1 normal-case text-ink-faint">(offspring sex always equals the Fallen's, validated against the live feed)</span>
              </p>
              {p.odds.expectedStats.value && (
                <p className="type-data mt-1 text-ink">
                  Expected stats (midpoint): <span style={{ color: "var(--gold)" }}>S {p.odds.expectedStats.value.start} · Sp {p.odds.expectedStats.value.speed} · St {p.odds.expectedStats.value.stamina} · F {p.odds.expectedStats.value.finish}</span>
                </p>
              )}
              <p className="type-data mt-1 text-ink-soft">Faction: {p.odds.faction.note}</p>
            </Block>

            {/* MODELED ODDS (empirical, with N) */}
            {preview.modeled && (
              <Block label={`Modeled odds, from ${preview.modeled.modelN} real duels`} tone="var(--cyan)">
                <p className="type-data text-ink">
                  Offspring rarity:{" "}
                  {preview.modeled.rarity.distribution.slice(0, 4).map((d, i) => (
                    <span key={i}><span style={{ color: "var(--gold)" }}>{d.name} {d.pct}%</span>{i < Math.min(3, preview.modeled!.rarity.distribution.length - 1) ? " · " : ""}</span>
                  ))}
                </p>
                <p className="type-micro mt-0.5 normal-case text-ink-faint">
                  {preview.modeled.rarity.basis === "data" ? `fit from ${preview.modeled.rarity.n} duels with this parent-rarity pair` : `this pairing is thin in the data (N=${preview.modeled.rarity.n}); using the documented rule (centered on the lower parent, capped climb, small slip)`}
                </p>
                {preview.modeled.faction && (
                  <p className="type-data mt-2 text-ink">Faction: <span className="text-ink-soft">offspring takes a parent's faction {preview.modeled.faction.inheritRatePct}% of the time (N={preview.modeled.faction.n})</span></p>
                )}
                <p className="type-data mt-1 text-ink">Who falls: <span className="text-ink-soft">{preview.modeled.fall.rule} (N={preview.modeled.fall.n})</span></p>
              </Block>
            )}

            {/* IS IT WORTH IT (valuation) */}
            <Block label="Is it worth it" tone="var(--gold)">
              {preview.modeled ? (
                <>
                  <p className="type-data text-ink">
                    You permanently burn one proven racer to mint a{" "}
                    <span style={{ color: "var(--gold)" }}>{preview.modeled.rarity.distribution[0]?.name} ({preview.modeled.rarity.distribution[0]?.pct}%)</span> Duelborn, gen {p.certain.generation ?? "?"} with a flat +{p.certain.generationBonus ?? "?"} Start/Speed/Finish boost.
                  </p>
                  {(() => {
                    const lo = Math.min(...[preview.a.rarity, preview.b.rarity].map((r) => RARITY_ORDER.indexOf(r ?? "")));
                    const up = preview.modeled.rarity.distribution.filter((d) => d.rarity > lo).reduce((s, d) => s + d.pct, 0);
                    return <p className="type-data mt-1 text-ink-soft">Rarity-upgrade chance: <span style={{ color: up > 0 ? "var(--gold)" : "var(--ink-faint)" }}>{up}%</span> (else it holds the lower parent's tier).</p>;
                  })()}
                  <p className="type-micro mt-1 normal-case text-ink-faint">
                    ETH net-value estimate is weak right now: per-rarity Gigling sale medians in our data are flat (~{preview.modeled.valuation.gainedEth} ETH across tiers, N={preview.modeled.valuation.gainedN}), so the real signal is the rarity-upgrade chance and the generation boost, not a dollar figure.
                  </p>
                </>
              ) : (
                <p className="type-data text-ink-soft">
                  You permanently burn one proven racer (glue yield {doomedParent ? (doomedParent.petId === preview.a.petId ? p.glue.a.deglueYield : p.glue.b.deglueYield) : `${p.glue.a.deglueYield}/${p.glue.b.deglueYield}`}) to mint a gen {p.certain.generation ?? "?"} Duelborn. Valuation model warming up.
                </p>
              )}
            </Block>

            {/* Pending */}
            <Block label="Still pending the model" tone="var(--ink-faint)">
              <ul className="space-y-1">
                <li className="type-data text-ink-faint">Stat 95% ranges (offspring stats are unrevealed at mint, so the spread is not yet fittable; expected = parent midpoint)</li>
                <li className="type-data text-ink-faint">Trait star-tiers (offspring traits are unrevealed at mint; documented rule only)</li>
              </ul>
            </Block>

            {/* CTA: link only, never sign */}
            <Link href={GIGA_DUEL_URL} target="_blank" rel="noopener noreferrer"
              className="transition-paddock inline-block rounded-md border px-5 py-2.5 type-micro uppercase tracking-wider hover:bg-paper-sunken"
              style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>
              Do this duel in Gigaverse
            </Link>
            <p className="type-micro normal-case text-ink-faint">Paddock never signs or submits a duel. The action happens in Gigaverse.</p>
          </div>
        )}
      </div>
    </div>
  );
}
