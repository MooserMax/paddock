import type { Metadata } from "next";
import WalletSearch from "@/components/WalletSearch";

export const metadata: Metadata = {
  title: "Wallet lookup",
  description: "Paste any wallet to read its Gigling stable: A-team, hidden gems, reveal queue, track assignments, and estimated value.",
};

const MODULES = [
  { title: "Stable value", body: "A band-based estimate from comparable sales. Honest about thin comps." },
  { title: "A-team", body: "The highest confirmed-quality horses, proven from revealed data." },
  { title: "Hidden gems", body: "Highest upside, still unrevealed. The lottery tickets worth racing." },
  { title: "Reveal queue", body: "Which horses are closest to their next trait reveal." },
];

export default function WalletLanding() {
  return (
    <div className="mx-auto max-w-page px-4 py-16 md:px-6 md:py-24">
      <div className="max-w-2xl">
        <p className="eyebrow assemble">Wallet lookup</p>
        <h1 className="type-page-title assemble mt-3 text-balance text-ink" style={{ animationDelay: "40ms" }}>
          Read any stable like a scout.
        </h1>
        <p className="type-body assemble mt-4 text-ink-soft" style={{ animationDelay: "80ms" }}>
          Paste a wallet address and Paddock assembles the full intelligence report: what is proven, what is potential, which horse to race next, and what the stable is worth. No wallet connection, no signing, read-only.
        </p>
        <div className="assemble mt-8" style={{ animationDelay: "120ms" }}>
          <WalletSearch size="lg" autoFocus />
        </div>
      </div>

      <div className="assemble mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" style={{ animationDelay: "160ms" }}>
        {MODULES.map((m) => (
          <div key={m.title} className="panel p-4">
            <p className="type-card-title text-ink">{m.title}</p>
            <p className="type-micro mt-1.5 normal-case leading-relaxed text-ink-faint">{m.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
