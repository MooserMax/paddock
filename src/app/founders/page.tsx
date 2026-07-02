import type { Metadata } from "next";
import Link from "next/link";
import { getFounders } from "@/lib/api/queries";
import type { FounderRow } from "@/lib/api/types";
import PetPortrait from "@/components/PetPortrait";
import OwnerLabel from "@/components/OwnerLabel";
import { rarityDisplay } from "@/lib/display";
import { formatEth } from "@/lib/format";

export const metadata: Metadata = {
  title: "Bloodline Founders",
  description: "Which genesis Giglings are seeding dynasties: ranked by Founder Score, a transparent blend of direct offspring, realized rarity-climb rate, and dominant-trait concentration.",
};

export const revalidate = 120;

type Sort = "offspring" | "climb" | "value";

export default async function FoundersPage(props: { searchParams: Promise<{ sort?: string }> }) {
  const sp = await props.searchParams;
  const sort: Sort = sp.sort === "climb" || sp.sort === "value" ? sp.sort : "offspring";
  const data = await getFounders(sort, 100, 0);

  const sexInitial = (s: string | null) => (s ? s[0].toUpperCase() : "?");
  const sortTabs: { key: Sort; label: string }[] = [
    { key: "offspring", label: "Direct offspring" },
    { key: "climb", label: "Climb rate" },
    { key: "value", label: "Bloodline value" },
  ];

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6">
        <p className="eyebrow" style={{ color: "var(--brick)" }}>Bloodline intelligence</p>
        <h1 className="type-page-title mt-2 text-ink">Founders</h1>
        <p className="type-body mt-2 max-w-2xl text-ink-soft">
          The genesis Giglings seeding dynasties. Ranked by Founder Score, a transparent blend of direct offspring, realized rarity-climb rate, and dominant-trait concentration. A great breeder is not always a great racer; this board finds them.
        </p>
        <p className="type-micro mt-2 normal-case text-ink-faint">{data.scoreExplainer}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {sortTabs.map((t) => (
          <Link key={t.key} href={`/founders?sort=${t.key}`} scroll={false}
            className="transition-paddock rounded-full border px-3 py-1 type-micro uppercase tracking-wider"
            style={{ borderColor: sort === t.key ? "var(--gold)" : "var(--line)", color: sort === t.key ? "var(--gold)" : "var(--ink-faint)", background: sort === t.key ? "color-mix(in srgb, var(--gold) 8%, transparent)" : "transparent" }}>
            {t.label}
          </Link>
        ))}
        <span className="type-micro self-center normal-case text-ink-faint">{data.total} founders</span>
      </div>

      {data.rows.length === 0 ? (
        <p className="type-data text-ink-faint">No founders with offspring yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border hairline">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b hairline-strong text-left">
                <th className="type-micro px-4 py-2 uppercase text-ink-faint">Founder</th>
                <th className="type-micro px-3 py-2 text-right uppercase text-ink-faint">Duelborn</th>
                <th className="type-micro px-3 py-2 text-right uppercase text-ink-faint">Gens</th>
                <th className="type-micro px-3 py-2 text-right uppercase text-ink-faint">Climb vs exp.</th>
                <th className="type-micro px-3 py-2 uppercase text-ink-faint">Dominant trait</th>
                <th className="type-micro px-3 py-2 text-right uppercase text-ink-faint">Est. value</th>
                <th className="type-micro px-3 py-2 text-right uppercase text-ink-faint">Founder score</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((f: FounderRow, i) => (
                <tr key={f.id} className="border-b hairline last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="type-data w-5 tabular-nums text-ink-faint">{i + 1}</span>
                      <span className="h-9 w-9 overflow-hidden rounded" style={{ flex: "0 0 auto" }}>
                        <PetPortrait src={f.imgUrl} alt={`Gigling #${f.id}`} size={36} />
                      </span>
                      <span>
                        <Link href={`/pet/${f.id}`} className="type-data text-ink transition-paddock hover:text-glow">{f.name ?? `#${f.id}`}</Link>
                        <span className="type-micro block normal-case text-ink-faint">
                          <span style={{ color: rarityDisplay(f.rarity.value).color }}>{f.rarity.name}</span> {sexInitial(f.sex)}{f.topTrait ? ` · ${f.topTrait}` : ""}{f.ownerAddress ? " · " : ""}
                          {f.ownerAddress && <OwnerLabel address={f.ownerAddress} name={f.ownerName} className="transition-paddock hover:text-glow" />}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="type-data px-3 py-2.5 text-right tabular-nums" style={{ color: "var(--gold)" }}>{f.directOffspring}</td>
                  <td className="type-data px-3 py-2.5 text-right tabular-nums text-ink-soft">{f.generationsSpanned}</td>
                  <td className="type-data px-3 py-2.5 text-right tabular-nums text-ink-soft">
                    {f.climb.total > 0 ? <>{f.climb.observed}/{f.climb.total} <span className="type-micro text-ink-faint">vs ~{f.climb.expectedPct}%</span></> : "-"}
                  </td>
                  <td className="type-data px-3 py-2.5 text-ink-soft">{f.dominantTrait ?? "-"}</td>
                  <td className="type-data px-3 py-2.5 text-right tabular-nums text-ink-soft">
                    {f.value.lowEth != null ? <>{formatEth(f.value.highEth ?? 0, 3)}{f.value.thin ? <span className="type-micro text-ink-faint"> thin</span> : ""}</> : "-"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="type-data tabular-nums text-ink">{f.score}</span>
                    <span className="type-micro block normal-case text-ink-faint">{f.scoreParts.offspring} off · {f.scoreParts.climb}% climb · {f.scoreParts.concentration}% conc</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
