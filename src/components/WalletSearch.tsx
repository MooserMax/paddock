"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export const DEMO_WALLET = "0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30";

// The hero action. Paste a wallet, or one click loads a showcase stable so a
// judge with no assets sees the full report immediately. No typing required.
export default function WalletSearch({ size = "lg", autoFocus = false }: { size?: "lg" | "md"; autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
      setError("That is not a wallet address. Paste a 0x address, or try the demo stable.");
      return;
    }
    setError(null);
    router.push(`/wallet/${v}`);
  }

  const big = size === "lg";

  return (
    <div className="w-full">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            autoFocus={autoFocus}
            inputMode="text"
            spellCheck={false}
            aria-label="Wallet address"
            aria-invalid={error ? true : undefined}
            placeholder="Paste any wallet address"
            className={`transition-paddock w-full rounded-md border bg-transparent text-ink outline-none placeholder:text-ink-faint hover:border-line-strong focus-visible:border-glow ${
              big ? "type-data px-4 py-3.5" : "type-data px-3 py-2.5"
            }`}
            style={{ borderColor: "var(--line-strong)", background: "var(--paper-raised)" }}
          />
        </div>
        <button
          type="submit"
          className={`transition-paddock rounded-md font-medium hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(232,105,79,0.3)] active:translate-y-0 ${big ? "px-6 py-3.5" : "px-4 py-2.5"}`}
          style={{ background: "var(--action)", color: "#14110f" }}
        >
          <span className="type-data" style={{ color: "#14110f" }}>Read the stable</span>
        </button>
        <button
          type="button"
          onClick={() => router.push(`/wallet/${DEMO_WALLET}`)}
          className={`transition-paddock rounded-md border text-ink-soft hover:text-ink hover:border-line-strong ${big ? "px-5 py-3.5" : "px-4 py-2.5"}`}
          style={{ borderColor: "var(--line-strong)" }}
        >
          <span className="type-data">Try a demo stable</span>
        </button>
      </form>
      {error && (
        <p className="type-micro mt-2 normal-case" style={{ color: "var(--glow)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
