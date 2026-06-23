import type { Metadata } from "next";
import WalletProvider from "@/components/racefinder/WalletProvider";
import StableHome from "@/components/stable/StableHome";

export const metadata: Metadata = {
  title: "Your stable",
  description: "Your Giglings, ranked by Paddock's quality score, with recent performances and your live race. Connect your wallet to load it automatically, or view any stable by address. Read-only, no signature.",
};

export const dynamic = "force-dynamic";

export default function StablePage({ searchParams }: { searchParams: { address?: string } }) {
  const address = searchParams.address && /^0x[0-9a-fA-F]{40}$/.test(searchParams.address) ? searchParams.address : "";

  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-6 max-w-2xl">
        <p className="eyebrow">Your stable</p>
        <h1 className="type-page-title mt-2 text-balance text-ink">Stable home</h1>
        <p className="type-body mt-3 text-ink-soft">
          Your Giglings ranked by Paddock&apos;s quality score, your recent results, and the race you are in right now. Connect to load it automatically, no address pasting. Read-only, no signature.
        </p>
      </header>

      <WalletProvider>
        <StableHome initialAddress={address} />
      </WalletProvider>
    </div>
  );
}
