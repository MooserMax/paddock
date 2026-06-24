import type { Metadata } from "next";
import RaceFinderBoard from "@/components/racefinder/RaceFinderBoard";
import WalletProvider from "@/components/racefinder/WalletProvider";

export const metadata: Metadata = {
  title: "Race Finder",
  description: "Live forming Gigling lobbies, ranked by your win edge. Paddock runs its own odds model, so it does not just show you open races, it estimates which one to enter and with which horse. Read-only, no login required.",
};

export const dynamic = "force-dynamic";

export default async function RaceFinderPage(props: { searchParams: Promise<{ wallet?: string }> }) {
  const searchParams = await props.searchParams;
  const wallet = searchParams.wallet && /^0x[0-9a-fA-F]{40}$/.test(searchParams.wallet) ? searchParams.wallet : "";

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6 max-w-2xl">
        <p className="eyebrow">Live forming lobbies</p>
        <h1 className="type-page-title mt-2 text-balance text-ink">Race Finder</h1>
        <p className="type-body mt-3 text-ink-soft">
          Open races, ranked by YOUR win edge. Paddock runs its own odds model, so it tells you which lobby to enter and with which horse, shown as an honest band, not a false-precise percent. Add your wallet address to see your edge in each field; read-only, no signature.
        </p>
      </header>

      <WalletProvider>
        <RaceFinderBoard initialWallet={wallet} />
      </WalletProvider>
    </div>
  );
}
