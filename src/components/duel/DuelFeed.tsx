import Link from "next/link";

// Live duel feed. Renders the Gigaverse duel listings (Preparing + Completed). Each carries the
// host/challenger pets, the outcome (loser/survivor), and the resulting Duelborn. Read-only.
interface Pet { id?: number; sex?: string; rarityName?: string; name?: string }
interface Listing {
  listingId: number; phaseName?: string; templateName?: string; priceWei?: string;
  hostPetId?: number; challengerPetId?: number;
  hostPet?: Pet; challengerPet?: Pet;
  offspring?: { id?: number; sex?: string; generation?: number };
  loserPetId?: number; survivorPetId?: number; forcedFinalDuel?: boolean;
}

function petLabel(p: Pet | undefined, id: number | undefined): string {
  if (!id) return "open slot";
  const sex = p?.sex ? p.sex[0].toUpperCase() : "";
  return `#${id}${sex ? ` ${sex}` : ""}`;
}

function Row({ l }: { l: Listing }) {
  const fee = l.priceWei && l.priceWei !== "0" ? `${(Number(l.priceWei) / 1e18).toFixed(4)} ETH` : "free";
  const resolved = l.phaseName === "RESOLVED" || !!l.offspring;
  return (
    <div className="flex flex-col gap-1 border-b hairline px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <span className="type-data w-16 tabular-nums text-ink-faint">#{l.listingId}</span>
      <span className="type-data flex-1 text-ink">
        <Link href={`/pet/${l.hostPetId}`} className="transition-paddock hover:text-glow">{petLabel(l.hostPet, l.hostPetId)}</Link>
        <span className="mx-1.5 text-ink-faint">vs</span>
        {l.challengerPetId ? (
          <Link href={`/pet/${l.challengerPetId}`} className="transition-paddock hover:text-glow">{petLabel(l.challengerPet, l.challengerPetId)}</Link>
        ) : (
          <span className="text-ink-faint">awaiting challenger</span>
        )}
        {l.forcedFinalDuel && <span className="type-micro ml-2 uppercase tracking-wider" style={{ color: "var(--brick)" }}>final duel</span>}
      </span>
      {resolved && l.offspring ? (
        <span className="type-data text-ink-soft">
          fell <span style={{ color: "var(--brick)" }}>#{l.loserPetId}</span>
          <span className="mx-1.5 text-ink-faint">→</span>
          Duelborn <Link href={`/pet/${l.offspring.id}`} className="transition-paddock" style={{ color: "var(--gold)" }}>#{l.offspring.id}</Link>
          <span className="type-micro ml-1 text-ink-faint">gen {l.offspring.generation}{l.offspring.sex ? ` ${l.offspring.sex[0].toUpperCase()}` : ""}</span>
        </span>
      ) : (
        <span className="type-micro w-28 text-right uppercase tracking-wider text-ink-faint">{l.phaseName ?? "preparing"} · {fee}</span>
      )}
    </div>
  );
}

export default function DuelFeed({ preparing, completed }: { preparing: Listing[]; completed: Listing[] }) {
  if (preparing.length === 0 && completed.length === 0) {
    return (
      <div className="panel p-8 text-center">
        <p className="type-card-title text-ink">No duels yet</p>
        <p className="type-body mt-1 text-ink-soft">The feed lights up as duels are posted and resolved.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="eyebrow mb-2">Completed ({completed.length})</p>
        <div className="overflow-hidden rounded-lg border hairline">
          {completed.length ? completed.map((l) => <Row key={l.listingId} l={l} />) : <p className="type-data px-4 py-3 text-ink-faint">None yet.</p>}
        </div>
      </div>
      <div>
        <p className="eyebrow mb-2">Preparing ({preparing.length})</p>
        <div className="overflow-hidden rounded-lg border hairline">
          {preparing.length ? preparing.map((l) => <Row key={l.listingId} l={l} />) : <p className="type-data px-4 py-3 text-ink-faint">None open.</p>}
        </div>
      </div>
    </div>
  );
}
