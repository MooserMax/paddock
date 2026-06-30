"use client";

import { useState } from "react";
import Link from "next/link";
import { DEMO_WALLET } from "@/components/WalletSearch";

interface RadarPet { petId: number; name: string | null; sex: string | null; racesRun: number; racesToGo: number; status: string; duelsLeft: number | null; rarity: string | null }
interface Radar {
  eligibleMales: RadarPet[]; eligibleFemales: RadarPet[]; approaching: RadarPet[]; danger: RadarPet[];
  counts: { eligible: number; approaching: number; danger: number; total: number };
}

function PetRow({ p, tone }: { p: RadarPet; tone?: "danger" | "gold" }) {
  return (
    <div className="flex items-center gap-3 border-b hairline px-3 py-2 last:border-0">
      <Link href={`/pet/${p.petId}`} className="type-data flex-1 truncate text-ink transition-paddock hover:text-glow">{p.name ?? `#${p.petId}`}</Link>
      {p.sex && <span className="type-micro uppercase text-ink-faint">{p.sex[0]}</span>}
      <span className="type-data w-16 text-right tabular-nums text-ink-soft">{p.racesRun} rc</span>
      {tone === "danger" ? (
        <span className="type-micro w-24 text-right uppercase tracking-wider" style={{ color: "var(--brick)" }}>final duel</span>
      ) : p.racesToGo > 0 ? (
        <span className="type-micro w-24 text-right uppercase tracking-wider text-ink-faint">{p.racesToGo} to go</span>
      ) : (
        <span className="type-micro w-24 text-right uppercase tracking-wider" style={{ color: tone === "gold" ? "var(--gold)" : "var(--green)" }}>
          {p.duelsLeft != null ? `${p.duelsLeft} duels` : "eligible"}
        </span>
      )}
    </div>
  );
}

function Col({ title, pets, tone }: { title: string; pets: RadarPet[]; tone?: "danger" | "gold" }) {
  return (
    <div>
      <p className="eyebrow mb-2">{title} ({pets.length})</p>
      <div className="overflow-hidden rounded-lg border hairline">
        {pets.length ? pets.slice(0, 50).map((p) => <PetRow key={p.petId} p={p} tone={tone} />) : <p className="type-data px-3 py-2 text-ink-faint">None.</p>}
      </div>
    </div>
  );
}

export default function DuelRadar({ minRaces }: { minRaces: number }) {
  const [addr, setAddr] = useState("");
  const [data, setData] = useState<Radar | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(a: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { setErr("Paste a 0x wallet address."); return; }
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/duel/radar?address=${a}`);
      if (!r.ok) throw new Error((await r.json())?.error?.message ?? "Lookup failed.");
      setData(await r.json());
    } catch (e) { setErr(e instanceof Error ? e.message : "Lookup failed."); setData(null); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); load(addr.trim()); }} className="mb-4 flex flex-wrap gap-2">
        <input
          value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x wallet address"
          className="type-data min-w-0 flex-1 rounded-md border hairline bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-faint"
        />
        <button type="submit" className="transition-paddock rounded-md border hairline px-4 py-2 type-micro uppercase tracking-wider text-ink-soft hover:text-ink hover:border-line-strong">Scan</button>
        <button type="button" onClick={() => { setAddr(DEMO_WALLET); load(DEMO_WALLET); }} className="transition-paddock rounded-md px-3 py-2 type-micro uppercase tracking-wider text-ink-faint hover:text-ink">Demo</button>
      </form>

      {err && <p className="type-micro mb-3 normal-case" style={{ color: "var(--brick)" }}>{err}</p>}
      {loading && <p className="type-data text-ink-faint">Scanning the stable...</p>}

      {data && (
        <>
          <div className="mb-4 flex flex-wrap gap-4">
            <span className="type-micro uppercase tracking-wider" style={{ color: "var(--green)" }}>{data.counts.eligible} eligible</span>
            <span className="type-micro uppercase tracking-wider text-ink-faint">{data.counts.approaching} approaching</span>
            {data.counts.danger > 0 && <span className="type-micro uppercase tracking-wider" style={{ color: "var(--brick)" }}>{data.counts.danger} on final duel</span>}
            <span className="type-micro uppercase tracking-wider text-ink-faint">{data.counts.total} Giglings</span>
          </div>
          {data.danger.length > 0 && <div className="mb-5"><Col title="Danger: fatal final duel" pets={data.danger} tone="danger" /></div>}
          <div className="grid gap-5 md:grid-cols-2">
            <Col title="Eligible males" pets={data.eligibleMales} tone="gold" />
            <Col title="Eligible females" pets={data.eligibleFemales} tone="gold" />
          </div>
          {data.approaching.length > 0 && (
            <div className="mt-5"><Col title={`Approaching (under ${minRaces} races)`} pets={data.approaching} /></div>
          )}
          {data.counts.eligible > 0 && data.eligibleMales.length > 0 && data.eligibleFemales.length > 0 && (
            <p className="type-micro mt-4 normal-case" style={{ color: "var(--gold)" }}>
              Viable pairings available: {data.eligibleMales.length} eligible male(s) x {data.eligibleFemales.length} eligible female(s).
            </p>
          )}
        </>
      )}
    </div>
  );
}
