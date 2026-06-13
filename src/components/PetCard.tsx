import Link from "next/link";
import Image from "next/image";
import type { PetCardDTO } from "@/lib/api/types";
import RarityBadge from "@/components/RarityBadge";
import { formatScore, formatPct } from "@/lib/format";

// A Gigling mini-card for stable modules. `metric` selects which engine number
// leads: confirmed quality (proven) for the A-team, upside (potential) for gems.
export default function PetCard({ pet, metric }: { pet: PetCardDTO; metric: "cq" | "upside" }) {
  const value = metric === "cq" ? pet.confirmedQuality : pet.upside;
  const label = metric === "cq" ? "confirmed" : "upside";
  const accent = metric === "cq" ? "var(--gold)" : "var(--cyan)";

  return (
    <Link
      href={`/pet/${pet.id}`}
      className="panel transition-paddock group flex items-center gap-3 p-3 hover:border-line-strong"
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border hairline bg-dotgrid">
        {pet.imgUrl ? (
          <Image src={pet.imgUrl} alt={`Gigling #${pet.id}`} width={48} height={48} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="type-data truncate text-ink">{pet.name ?? `#${pet.id}`}</span>
          <RarityBadge rarity={pet.rarity.value} size="sm" />
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--paper-sunken)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, pet.revealPct * 100)}%`, background: "var(--glow)" }} />
          </div>
          <span className="type-micro text-ink-faint">{formatPct(pet.revealPct)} revealed</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="type-data tabular-nums" style={{ color: accent }}>{formatScore(value)}</div>
        <div className="type-micro uppercase text-ink-faint">{label}</div>
      </div>
    </Link>
  );
}
