import Link from "next/link";

// Demoted proof-of-model feed: ONE deduplicated column of recent RESOLVED duels matched to the
// on-chain Duelborn. Not the headline; it shows the model lines up with reality. Read-only.
interface Pet { id?: number; sex?: string; rarityName?: string }
interface Listing {
  listingId: number; phaseName?: string;
  hostPetId?: number; challengerPetId?: number; hostPet?: Pet; challengerPet?: Pet;
  offspring?: { id?: number; sex?: string; generation?: number };
  loserPetId?: number; survivorPetId?: number;
}

export default function DuelFeed({ completed }: { completed: Listing[] }) {
  const rows = completed.filter((l) => l.offspring?.id).slice(0, 12);
  if (rows.length === 0) {
    return <p className="type-data text-ink-faint">No resolved duels matched to chain yet.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border hairline">
      {rows.map((l) => (
        <div key={l.listingId} className="flex flex-col gap-1 border-b hairline px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
          <span className="type-data w-14 tabular-nums text-ink-faint">#{l.listingId}</span>
          <span className="type-data flex-1 text-ink-soft">
            <Link href={`/pet/${l.survivorPetId}`} className="transition-paddock hover:text-glow">#{l.survivorPetId}</Link> survived ·{" "}
            <span style={{ color: "var(--brick)" }}>#{l.loserPetId} fell</span>
          </span>
          <span className="type-data text-ink-soft">
            Duelborn <Link href={`/pet/${l.offspring!.id}`} className="transition-paddock" style={{ color: "var(--gold)" }}>#{l.offspring!.id}</Link>
            <span className="type-micro ml-1 text-ink-faint">gen {l.offspring!.generation}{l.offspring!.sex ? ` ${l.offspring!.sex[0].toUpperCase()}` : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
