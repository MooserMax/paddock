"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DEMO_WALLET } from "@/components/WalletSearch";
import { useWalletAddress } from "@/lib/walletFlag";

interface RadarPet { petId: number; name: string | null; sex: string | null; racesRun: number; racesToGo: number; status: string; duelsLeft: number | null; rarity: string | null; isFinal: boolean; cq: number | null; topTrait: string | null }
interface Radar {
  eligibleMales: RadarPet[]; eligibleFemales: RadarPet[];
  approaching: RadarPet[]; finalDuel: RadarPet[]; pathToBreeding: RadarPet[];
  coverage: { hasEligibleMale: boolean; hasEligibleFemale: boolean; needSex: "male" | "female" | null };
  counts: { eligible: number; approaching: number; final: number; total: number };
}

interface Outcome<T> { status: string; value?: T; note: string }
interface Stats { start: number; speed: number; stamina: number; finish: number }
interface Preview {
  valid: { ok: boolean; errors: string[]; warnings: string[] };
  certain: { generation: number | null; generationBonus: number | null; genderRule: string; forcedFallen: number | null };
  odds: { faction: Outcome<string>; expectedStats: Outcome<Stats> };
  pending: string[];
  glue: { a: { deglueYield: number | null; reglueCost: number | null }; b: { deglueYield: number | null; reglueCost: number | null } };
}
interface PreviewParent { petId: number; sex: string | null; rarity: string | null; generation: number | null; factionName: string | null; racesRun: number | null; duelsLeft: number | null }
interface RarityDist { rarity: number; name: string; pct: number }
interface Backtest { rarity: Acc; generation: Acc; gender: Acc; faction: Acc; statFloor: Acc }
interface Acc { correct: number; n: number }
type Verdict = "worth" | "even" | "not" | "unknown";
interface Valuation { burnedEth: number | null; gainedEth: number | null; netEth: number | null; verdict: Verdict; note: string }
interface Modeled {
  modelN: number;
  rarity: { distribution: RarityDist[]; mostLikely: number; n: number; basis: string };
  statFloor: { floor: number | null; n: number };
  faction: { inheritRatePct: number; n: number } | null;
  fall: { note: string; n: number };
  traitsNote: string;
  backtest: Backtest;
  valuation: Valuation & { burnedSource: string; gainedN: number };
  caveat: string;
}
interface PreviewResult { a: PreviewParent; b: PreviewParent; preview: Preview; modeled: Modeled | null }

interface PairParent { petId: number; name: string | null; rarity: string | null; cq: number; winRate: number | null; bestDistance: number; topTrait: string | null; elo: number | null; isFinal: boolean }
interface Suggestion {
  male: PairParent; female: PairParent;
  predictedRarity: { name: string; pct: number; n: number; basis: string };
  distribution: RarityDist[]; distributionN: number; distributionBasis: string;
  upgradeChancePct: number; climbObserved: { count: number; total: number } | null;
  expectedRarity: number; reachStableMaxPct: number;
  generation: number | null; statFloor: number | null;
  faction: { inheritRatePct: number; n: number } | null;
  fallenPetId: number; keptPetId: number; offspringGender: string | null;
  forced: boolean; forcedNote: string | null; leavesKeptOnFinal: number | null;
  valuation: Valuation; why: string;
}
interface BestPairings { goal: string; suggestions: Suggestion[]; modelN: number; note: string }

const GIGA_DUEL_URL = "https://gigaverse.io/duel";
const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Relic", "Giga"];
const APPROACH_MIN = 25;

const GOALS: { key: string; label: string }[] = [
  { key: "best", label: "Best expected offspring" },
  { key: "rarity", label: "Chase rarity" },
  { key: "preserve", label: "Preserve a proven racer" },
  { key: "cheapest", label: "Cheapest viable" },
];
const GOAL_METRIC: Record<string, string> = {
  best: "Ranks by expected offspring rarity (probability-weighted mean of the model distribution), blended with the confirmed race quality of the parent you keep.",
  rarity: "Ranks by expected offspring rarity (probability-weighted mean), then climb chance, then the chance to reach your best parent's tier. Any pairing with a climb chance outranks a same-floor pairing with none.",
  preserve: "Ranks pairings that keep your best proven racer and sacrifice the weaker one; forced final-duel sacrifices of a weak racer rise to the top.",
  cheapest: "Ranks by the lowest-value parent to sacrifice.",
};

const VERDICT: Record<Verdict, { label: string; color: string }> = {
  worth: { label: "Likely worth it", color: "var(--green)" },
  even: { label: "Roughly even", color: "var(--gold)" },
  not: { label: "Likely not worth it", color: "var(--brick)" },
  unknown: { label: "Directional only", color: "var(--ink-faint)" },
};

const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

function PetCard({ p, selected, onSelect }: { p: RadarPet; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="transition-paddock w-full rounded-lg border p-3 text-left hover:border-line-strong"
      style={{ borderColor: selected ? "var(--gold)" : p.isFinal ? "var(--brick)" : "var(--line)", background: selected ? "color-mix(in srgb, var(--gold) 8%, transparent)" : "transparent" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="type-data truncate text-ink">{p.name ?? `#${p.petId}`}</span>
        {p.isFinal && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>final duel</span>}
      </div>
      <div className="type-micro mt-1 normal-case text-ink-faint">
        {p.rarity ?? "?"}{p.topTrait ? ` ${p.topTrait}` : ""} · {p.racesRun} races · {p.duelsLeft != null ? `${p.duelsLeft} duels left` : "duels: max"}
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

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border hairline p-4" style={{ background: "var(--paper-raised)" }}>
          <div className="assemble h-3 w-2/3 rounded" style={{ background: "var(--line)" }} />
          <div className="assemble mt-2 h-3 w-1/2 rounded" style={{ background: "var(--line)", animationDelay: "80ms" }} />
        </div>
      ))}
    </div>
  );
}

function climbText(s: Suggestion): string {
  if (s.distributionBasis === "data" && s.climbObserved) return `${s.upgradeChancePct}% climbed (${s.climbObserved.count} of ${s.climbObserved.total} observed)`;
  return `${s.upgradeChancePct}% climb (rule-based, thin data n=${s.distributionN})`;
}

function PairingDetail({ s }: { s: Suggestion }) {
  const Parent = ({ p, label }: { p: PairParent; label: string }) => (
    <div>
      <p className="type-micro uppercase tracking-wider text-ink-faint">{label}: <Link href={`/pet/${p.petId}`} className="transition-paddock text-ink-soft hover:text-glow">#{p.petId}</Link> {p.rarity}{p.isFinal ? " · final duel" : ""}</p>
      <p className="type-data mt-0.5 text-ink-soft">CQ {p.cq} · {p.winRate != null ? `${Math.round(p.winRate * 100)}% win` : "no races"} · best {p.bestDistance}m{p.topTrait ? ` · ${p.topTrait}` : ""}{p.elo != null ? ` · ELO ${Math.round(p.elo)}` : ""}</p>
    </div>
  );
  return (
    <div className="mt-3 space-y-3 border-t pt-3 hairline">
      <div>
        <p className="type-micro uppercase tracking-wider text-ink-faint">Offspring rarity distribution {s.distributionBasis === "data" ? `(from ${s.distributionN} similar duels)` : "(rule-based, thin data)"}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {s.distribution.map((d, i) => (
            <span key={i} className="type-data text-ink-soft"><span style={{ color: "var(--gold)" }}>{d.name}</span> {d.pct}%</span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 type-data text-ink-soft">
        <span>Stat floor {s.statFloor ?? "?"} to a ceiling of 100</span>
        {s.faction && <span>Faction inherited {s.faction.inheritRatePct}% of the time (N={s.faction.n})</span>}
        <span>Generation {s.generation ?? "?"}</span>
      </div>
      <p className="type-data text-ink-soft">
        {s.forced ? s.forcedNote : `Who falls is your choice via Host Favour; we recommend sacrificing #${s.fallenPetId} so you keep the better racer. Duelborn gender = the fallen parent's (${s.offspringGender ?? "?"}).`}
        {s.leavesKeptOnFinal != null && <span className="text-ink-faint"> This leaves #{s.leavesKeptOnFinal} on its final duel.</span>}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Parent p={s.male} label="Male" />
        <Parent p={s.female} label="Female" />
      </div>
    </div>
  );
}

export default function DuelStudio({ minRaces, modelN, accuracy }: { minRaces: number; modelN: number; accuracy: Backtest | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connected = useWalletAddress();

  const [addr, setAddr] = useState("");
  const [scannedAddr, setScannedAddr] = useState("");
  const [radar, setRadar] = useState<Radar | null>(null);
  const [loadingR, setLoadingR] = useState(false);
  const [errR, setErrR] = useState<string | null>(null);

  const [male, setMale] = useState<number | null>(null);
  const [female, setFemale] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loadingP, setLoadingP] = useState(false);
  const [errP, setErrP] = useState<string | null>(null);

  const [best, setBest] = useState<BestPairings | null>(null);
  const [loadingB, setLoadingB] = useState(false);
  const [goal, setGoal] = useState("best");
  const [expanded, setExpanded] = useState<number | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const didInit = useRef(false);

  // Keep the URL as the single source of shareable state (wallet, goal, m, f). No localStorage.
  const syncUrl = useCallback((next: { wallet?: string; goal?: string; m?: number | null; f?: number | null }) => {
    const p = new URLSearchParams(searchParams.toString());
    if (next.wallet !== undefined) { if (next.wallet) p.set("wallet", next.wallet); else p.delete("wallet"); }
    if (next.goal !== undefined) p.set("goal", next.goal);
    if (next.m !== undefined) { if (next.m) p.set("m", String(next.m)); else p.delete("m"); }
    if (next.f !== undefined) { if (next.f) p.set("f", String(next.f)); else p.delete("f"); }
    router.replace(`/duel?${p.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const loadBest = useCallback((a: string, g: string) => {
    setLoadingB(true);
    fetch(`/api/v1/duel/best-pairings?address=${a}&goal=${g}`).then((x) => x.ok ? x.json() : null).then((b) => setBest(b)).catch(() => setBest(null)).finally(() => setLoadingB(false));
  }, []);

  const runPreview = useCallback(async (a: number, b: number) => {
    setLoadingP(true); setErrP(null);
    try {
      const r = await fetch(`/api/v1/duel/preview?a=${a}&b=${b}`);
      if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Preview failed.");
      setPreview(await r.json());
    } catch (e) { setErrP(e instanceof Error ? e.message : "Preview failed."); setPreview(null); }
    finally { setLoadingP(false); }
  }, []);

  const scan = useCallback(async (a: string, g: string) => {
    if (!isAddr(a)) { setErrR("Paste a 0x wallet address."); return; }
    setLoadingR(true); setErrR(null); setBest(null); setScannedAddr(a);
    try {
      const r = await fetch(`/api/v1/duel/radar?address=${a}`);
      if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Lookup failed.");
      setRadar(await r.json());
      loadBest(a, g);
    } catch (e) { setErrR(e instanceof Error ? e.message : "Lookup failed."); setRadar(null); }
    finally { setLoadingR(false); }
  }, [loadBest]);

  // D2: cold-load from URL params (validated; garbage degrades to the clean page, never an error).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const w = searchParams.get("wallet") ?? "";
    const g = searchParams.get("goal") ?? "best";
    const m = Number(searchParams.get("m")) || null;
    const f = Number(searchParams.get("f")) || null;
    if (GOALS.some((x) => x.key === g)) setGoal(g);
    if (m) setMale(m);
    if (f) setFemale(f);
    if (isAddr(w)) { setAddr(w); scan(w, GOALS.some((x) => x.key === g) ? g : "best"); }
    if (m && f) runPreview(m, f);
  }, [searchParams, scan, runPreview]);

  function pickGoal(g: string) {
    setGoal(g);
    syncUrl({ goal: g });
    if (scannedAddr) loadBest(scannedAddr, g);
  }

  function onScanSubmit(a: string) {
    setMale(null); setFemale(null); setPreview(null);
    syncUrl({ wallet: a, goal, m: null, f: null });
    scan(a, goal);
  }

  const selectPair = useCallback((m: number, f: number) => {
    setMale(m); setFemale(f);
    syncUrl({ m, f });
    runPreview(m, f);
    // D1: scroll the preview into view after it starts loading.
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [runPreview, syncUrl]);

  function pick(sex: "male" | "female", id: number) {
    const nm = sex === "male" ? male : female;
    const next = nm === id ? null : id;
    const m = sex === "male" ? next : male;
    const f = sex === "female" ? next : female;
    if (sex === "male") setMale(next); else setFemale(next);
    syncUrl({ m: sex === "male" ? next : male, f: sex === "female" ? next : female });
    if (m && f) runPreview(m, f); else setPreview(null);
  }

  const p = preview?.preview;

  return (
    <div className="space-y-8">
      {/* A. Scan box. Pre-scan is the clean explainer. */}
      <div>
        <form onSubmit={(e) => { e.preventDefault(); onScanSubmit(addr.trim()); }} className="flex flex-wrap gap-2">
          <input
            value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Paste a wallet to rank its best pairings"
            className="type-data min-w-0 flex-1 rounded-md border hairline bg-transparent px-3.5 py-2.5 text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="submit" className="transition-paddock rounded-md border hairline px-5 py-2.5 type-micro uppercase tracking-wider text-ink-soft hover:text-ink hover:border-line-strong">Scan stable</button>
          {connected && isAddr(connected) && (
            <button type="button" onClick={() => { setAddr(connected); onScanSubmit(connected); }} className="transition-paddock rounded-md border px-4 py-2.5 type-micro uppercase tracking-wider" style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>Scan my stable</button>
          )}
          <button type="button" onClick={() => { setAddr(DEMO_WALLET); onScanSubmit(DEMO_WALLET); }} className="transition-paddock rounded-md px-3 py-2.5 type-micro uppercase tracking-wider text-ink-faint hover:text-ink">Demo</button>
        </form>
        {errR && <p className="type-micro mt-2 normal-case" style={{ color: "var(--brick)" }}>{errR}</p>}
        {loadingR && <div className="mt-4"><Skeleton rows={2} /></div>}

        {radar && !loadingR && (
          <div className="mt-4 flex flex-wrap gap-4">
            <span className="type-micro uppercase tracking-wider" style={{ color: "var(--gold)" }}>{radar.counts.eligible} ready to breed</span>
            {radar.counts.final > 0 && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>{radar.counts.final} on a final duel</span>}
            <span className="type-micro uppercase tracking-wider text-ink-faint">{radar.counts.approaching} approaching · {radar.counts.total} Giglings</span>
          </div>
        )}
      </div>

      {/* B. Path to breeding: the empty state becomes a development plan. Full when 0 ready. */}
      {radar && !loadingR && radar.pathToBreeding.length > 0 && (
        radar.counts.eligible === 0 ? (
          <PathPanel radar={radar} collapsed={false} />
        ) : (
          <details className="rounded-lg border hairline" style={{ background: "var(--paper-raised)" }}>
            <summary className="cursor-pointer px-4 py-3 type-micro uppercase tracking-wider text-ink-soft">Path to breeding: {radar.pathToBreeding.length} more Giglings developing</summary>
            <div className="px-4 pb-4"><PathPanel radar={radar} collapsed /></div>
          </details>
        )
      )}

      {/* C. HERO after a scan: the ranked recommender. */}
      {radar && !loadingR && (
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="type-section text-ink">Best pairings for this stable</h2>
            {best && <p className="type-micro normal-case text-ink-faint">{best.note}</p>}
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <button key={g.key} type="button" onClick={() => pickGoal(g.key)}
                className="transition-paddock rounded-full border px-3 py-1 type-micro uppercase tracking-wider"
                style={{ borderColor: goal === g.key ? "var(--gold)" : "var(--line)", color: goal === g.key ? "var(--gold)" : "var(--ink-faint)", background: goal === g.key ? "color-mix(in srgb, var(--gold) 8%, transparent)" : "transparent" }}>
                {g.label}
              </button>
            ))}
          </div>
          <p className="type-micro mb-4 normal-case text-ink-faint">{GOAL_METRIC[goal]}</p>

          {radar.counts.eligible === 0 ? (
            <p className="type-data text-ink-faint">No Giglings with {minRaces}+ races and a free duel yet. Develop the horses above, then come back; Paddock ranks the pairings when they qualify.</p>
          ) : loadingB ? (
            <Skeleton rows={4} />
          ) : !best || best.suggestions.length === 0 ? (
            <p className="type-data text-ink-faint">No viable male + female pairing in this stable (a duel needs one of each; two final-duel pets cannot meet).</p>
          ) : (
            <div className="space-y-2">
              {best.suggestions.slice(0, 6).map((s, i) => {
                const v = VERDICT[s.valuation.verdict];
                const isOpen = expanded === i;
                return (
                  <div key={i} className="rounded-lg border hairline p-4" style={{ background: "var(--paper-raised)" }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="type-data tabular-nums text-ink-faint">{i + 1}</span>
                        <button type="button" onClick={() => selectPair(s.male.petId, s.female.petId)}
                          className="transition-paddock type-data text-left text-ink hover:text-glow">
                          #{s.male.petId} {s.male.rarity ?? ""} <span className="text-ink-faint">x</span> #{s.female.petId} {s.female.rarity ?? ""}
                        </button>
                      </div>
                      <span className="type-micro uppercase tracking-wider" style={{ color: v.color }}>{v.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 type-data text-ink-soft">
                      <span>Duelborn <span style={{ color: "var(--gold)" }}>{s.predictedRarity.name} {s.predictedRarity.pct}%</span>{s.predictedRarity.basis !== "data" ? " (rule)" : ""}</span>
                      <span>gen {s.generation ?? "?"}</span>
                      {s.statFloor != null && <span>floor {s.statFloor}</span>}
                      <span className={s.upgradeChancePct > 0 ? "" : "text-ink-faint"} style={s.upgradeChancePct > 0 ? { color: "var(--gold)" } : undefined}>{climbText(s)}</span>
                      {s.forced
                        ? <span style={{ color: "var(--brick)" }}>FORCED: #{s.fallenPetId} falls</span>
                        : <span>sacrifice <span style={{ color: "var(--brick)" }}>#{s.fallenPetId}</span> ({s.offspringGender ?? "?"} Duelborn)</span>}
                    </div>
                    <p className="type-micro mt-1.5 normal-case text-ink-faint">{s.why} {s.valuation.note}{s.leavesKeptOnFinal != null ? ` This leaves #${s.leavesKeptOnFinal} on its final duel.` : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <button type="button" onClick={() => selectPair(s.male.petId, s.female.petId)} className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-glow">Load in preview</button>
                      <button type="button" onClick={() => setExpanded(isOpen ? null : i)} className="type-micro uppercase tracking-wider text-ink-faint transition-paddock hover:text-glow">{isOpen ? "Hide detail" : "Show detail"}</button>
                    </div>
                    {isOpen && <PairingDetail s={s} />}
                  </div>
                );
              })}
            </div>
          )}

          {/* Eligible pools, for a manual pick. Final-duel pets are tagged. */}
          {radar.counts.eligible > 0 && (
            <div className="mt-6 grid gap-5 md:grid-cols-2">
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
                  {radar.eligibleFemales.length === 0 && <p className="type-data text-ink-faint">None eligible. {radar.coverage.needSex === "female" ? "You will also need an eligible female." : ""}</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* D. Manual breeding preview. */}
      <div ref={previewRef} className="rounded-2xl border hairline p-5 md:p-6" style={{ background: "var(--paper-raised)" }}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="type-section text-ink">Breeding preview</h2>
          <div className="flex flex-wrap gap-2">
            <input value={male ?? ""} onChange={(e) => { const v = Number(e.target.value) || null; setMale(v); syncUrl({ m: v }); if (v && female) runPreview(v, female); }} placeholder="Male id" inputMode="numeric"
              className="type-data w-28 rounded-md border hairline bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-ink-faint" />
            <input value={female ?? ""} onChange={(e) => { const v = Number(e.target.value) || null; setFemale(v); syncUrl({ f: v }); if (v && male) runPreview(male, v); }} placeholder="Female id" inputMode="numeric"
              className="type-data w-28 rounded-md border hairline bg-transparent px-3 py-1.5 text-ink outline-none placeholder:text-ink-faint" />
          </div>
        </div>

        {!preview && !loadingP && <p className="type-data text-ink-faint">Pick a ranked pairing above, one eligible male and one female, or type two ids, to preview the Duelborn.</p>}
        {loadingP && <Skeleton rows={3} />}
        {errP && <p className="type-micro normal-case" style={{ color: "var(--brick)" }}>{errP}</p>}

        {preview && p && !loadingP && (
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

            <Block label="Who falls" tone="var(--brick)">
              <p className="type-data text-ink-soft">
                You choose who falls via Host Favour: set it to max to sacrifice the challenger, to min to sacrifice the host. The parent that falls is permanently destroyed and becomes the Duelborn.
                {preview.modeled && <span className="type-micro ml-1 normal-case text-ink-faint">{preview.modeled.fall.note}</span>}
              </p>
            </Block>

            <Block label="What you get" tone="var(--green)">
              <p className="type-data text-ink">
                Duelborn generation <span style={{ color: "var(--gold)" }}>{p.certain.generation ?? "?"}</span>
                {p.certain.generationBonus != null && <span className="text-ink-soft"> (+{p.certain.generationBonus} flat Start/Speed/Finish)</span>}
              </p>
              <p className="type-data mt-1 text-ink-soft">Gender: {p.certain.genderRule}</p>
              {preview.modeled?.statFloor.floor != null && (
                <p className="type-data mt-1 text-ink">Stat floor <span style={{ color: "var(--gold)" }}>{preview.modeled.statFloor.floor}</span> <span className="text-ink-soft">to a ceiling of 100 (set by the offspring rarity; actual values narrow as the Duelborn races)</span></p>
              )}
              <p className="type-data mt-1 text-ink-soft">Faction: {p.odds.faction.note}</p>
            </Block>

            {preview.modeled && (
              <Block label={`Modeled odds, from ${preview.modeled.modelN} real duels`} tone="var(--cyan)">
                <p className="type-data text-ink">
                  Offspring rarity:{" "}
                  {preview.modeled.rarity.distribution.slice(0, 4).map((d, i) => (
                    <span key={i}><span style={{ color: "var(--gold)" }}>{d.name} {d.pct}%</span>{i < Math.min(3, preview.modeled!.rarity.distribution.length - 1) ? " · " : ""}</span>
                  ))}
                </p>
                <p className="type-micro mt-0.5 normal-case text-ink-faint">
                  {preview.modeled.rarity.basis === "data" ? `fit from ${preview.modeled.rarity.n} duels with this parent-rarity pair` : `this pairing is thin in the data (n=${preview.modeled.rarity.n}); using the documented rule (centered on the lower parent, capped climb, small slip)`}
                </p>
                {preview.modeled.faction && (
                  <p className="type-data mt-2 text-ink">Faction: <span className="text-ink-soft">offspring takes a parent&apos;s faction {preview.modeled.faction.inheritRatePct}% of the time (N={preview.modeled.faction.n})</span></p>
                )}
                <p className="type-data mt-1 text-ink-soft">{preview.modeled.traitsNote}</p>
              </Block>
            )}

            {preview.modeled && (
              <Block label="Is it worth it" tone={VERDICT[preview.modeled.valuation.verdict].color}>
                <p className="type-data text-ink">
                  <span style={{ color: VERDICT[preview.modeled.valuation.verdict].color }}>{VERDICT[preview.modeled.valuation.verdict].label}.</span>{" "}
                  You permanently burn one proven racer to mint a {preview.modeled.rarity.distribution[0]?.name} ({preview.modeled.rarity.distribution[0]?.pct}%) Duelborn, gen {p.certain.generation ?? "?"} with +{p.certain.generationBonus ?? "?"} Start/Speed/Finish.
                </p>
                {(() => {
                  const lo = Math.min(...[preview.a.rarity, preview.b.rarity].map((r) => RARITY_ORDER.indexOf(r ?? "")));
                  const up = preview.modeled!.rarity.distribution.filter((d) => d.rarity > lo).reduce((s, d) => s + d.pct, 0);
                  return <p className="type-data mt-1 text-ink-soft">Rarity-upgrade chance: <span style={{ color: up > 0 ? "var(--gold)" : "var(--ink-faint)" }}>{up}%</span> (else it holds the lower parent&apos;s tier).</p>;
                })()}
                <p className="type-micro mt-1 normal-case text-ink-faint">{preview.modeled.valuation.note}</p>
              </Block>
            )}

            {accuracy && (
              <Block label="Model accuracy (backtested on the resolved set)" tone="var(--ink-faint)">
                <p className="type-data text-ink-soft">
                  Rarity {accuracy.rarity.correct}/{accuracy.rarity.n} · generation {accuracy.generation.correct}/{accuracy.generation.n} · gender {accuracy.gender.correct}/{accuracy.gender.n} · faction {accuracy.faction.correct}/{accuracy.faction.n} · stat floor {accuracy.statFloor.correct}/{accuracy.statFloor.n}
                </p>
                <p className="type-micro mt-1 normal-case text-ink-faint">Modeled from {modelN} resolved duels on-chain. Traits and exact stats reveal only through racing and are not predicted.</p>
              </Block>
            )}

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

function PathPanel({ radar, collapsed }: { radar: Radar; collapsed: boolean }) {
  return (
    <div className={collapsed ? "" : "rounded-lg border p-5"} style={collapsed ? undefined : { borderColor: "var(--cyan)", background: "color-mix(in srgb, var(--cyan) 6%, transparent)" }}>
      {!collapsed && <p className="type-card-title text-ink">Path to breeding</p>}
      {!collapsed && (
        <p className="type-body mt-1 text-ink-soft">
          No Giglings qualify yet ({40} races and an unspent duel are needed). Here are the closest, ranked by races remaining then confirmed quality, so you develop the horses that will matter.
        </p>
      )}
      <ul className="mt-3 space-y-1.5">
        {radar.pathToBreeding.map((pt) => (
          <li key={pt.petId} className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/pet/${pt.petId}`} className="type-data text-ink transition-paddock hover:text-glow">
              #{pt.petId} <span className="text-ink-soft">{pt.rarity ?? "?"}{pt.topTrait ? ` ${pt.topTrait}` : ""} ({pt.sex ? pt.sex[0].toUpperCase() : "?"})</span>
            </Link>
            <span className="type-data tabular-nums text-ink-soft">{pt.racesRun} of 40 races <span className="text-ink-faint">· {pt.racesToGo} to go</span></span>
          </li>
        ))}
      </ul>
      <p className="type-micro mt-3 normal-case text-ink-faint">
        Approaching means {APPROACH_MIN}+ of 40 races. Ordered by races remaining, then confirmed quality.
        {radar.coverage.needSex ? ` You will also need an eligible ${radar.coverage.needSex}, since a pairing needs one of each.` : ""}
        {" "}Develop them in free races, then come back; Paddock ranks the pairings when they qualify.
      </p>
    </div>
  );
}
