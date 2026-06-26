import type { Metadata } from "next";
import DevelopBoard from "@/components/develop/DevelopBoard";
import { DEVELOP_MODE_ENABLED } from "@/lib/entry/joinRace";

export const metadata: Metadata = {
  title: "Develop Mode",
  description: "Race your least-revealed Giglings into free races to farm stat reveals in bulk, one approval, zero ETH. Paddock ranks your horses by development need and batches the entries with EIP-5792.",
};

export const dynamic = "force-dynamic";

export default async function DevelopPage(props: { searchParams: Promise<{ wallet?: string; pick?: string; from?: string }> }) {
  const searchParams = await props.searchParams;
  const wallet = searchParams.wallet && /^0x[0-9a-fA-F]{40}$/.test(searchParams.wallet) ? searchParams.wallet : "";
  // Optional set to stage from the Stable report's "Develop these" buttons. A set
  // NAME (resolved fresh against the connected wallet), so it survives connect and a
  // refresh re-applies it.
  const pickRaw = (searchParams.pick ?? "").toLowerCase();
  const initialPickSet = (["areteam", "hiddengems", "nextreveals"] as const).includes(pickRaw as never) ? pickRaw : "";

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6 max-w-2xl">
        <p className="eyebrow">Bulk reveal farming</p>
        <h1 className="type-page-title mt-2 text-balance text-ink">Develop Mode</h1>
        <p className="type-body mt-3 text-ink-soft">
          Develop your horses. Race your least-revealed Giglings in free races to farm stat reveals, in bulk, for no entry fee. Pick horses with the filters below, or jump straight to a set with A-Team, Hidden Gems, or Next reveals. Paddock stages each one and you enter them all in a single signature.
        </p>
      </header>

      {DEVELOP_MODE_ENABLED ? (
        <DevelopBoard initialWallet={wallet} initialPickSet={initialPickSet} />
      ) : (
        <div className="panel p-8 text-center">
          <p className="type-card-title text-ink">Develop Mode is coming soon</p>
          <p className="type-body mt-1 text-ink-soft">Bulk reveal farming with one-signature batched entry. Check back shortly.</p>
        </div>
      )}
    </div>
  );
}
