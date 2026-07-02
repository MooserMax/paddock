import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Bloodline" };

// DEFERRED: the full interactive pan/zoom bloodline tree. Every Duelborn on-chain is currently
// gen 2, so ancestry is only two levels deep, a zoom/pan graph is not worth the complexity yet.
// The data layer (/api/v1/lineage/[id]) is built and the dossier Bloodline band ships now; this
// visual tree arrives when gen-3+ lineages exist. This is an intentional stub, not a broken route.
export default async function BloodlineStub(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return (
    <div className="mx-auto max-w-page px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-xl text-center">
        <p className="eyebrow" style={{ color: "var(--brick)" }}>Bloodline</p>
        <h1 className="type-page-title mt-2 text-ink">The full tree is coming</h1>
        <p className="type-body mt-3 text-ink-soft">
          Every Duelborn so far is generation 2, so a bloodline is only two levels deep today. The interactive tree arrives as generations climb and the graph is worth exploring visually. Until then, the Bloodline band on each dossier carries the lineage and its analytics.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={`/pet/${id}`} className="transition-paddock rounded-md border px-5 py-2.5 type-micro uppercase tracking-wider hover:bg-paper-sunken" style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>
            Back to Gigling #{id}
          </Link>
          <Link href="/founders" className="transition-paddock rounded-md border hairline px-5 py-2.5 type-micro uppercase tracking-wider text-ink-soft hover:text-ink hover:border-line-strong">
            See the Founders board
          </Link>
        </div>
      </div>
    </div>
  );
}
