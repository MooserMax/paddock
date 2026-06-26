"use client";

import Link from "next/link";
import { useWalletAddress } from "@/lib/walletFlag";

// The "My races" pill, alongside the server-rendered track pills. It reads the
// connected wallet from the lightweight flag (no wagmi provider on this page) and
// links to /races?wallet=<addr>, preserving the active track so "My races + 1200m"
// composes. Active state is driven by the wallet URL param, so a shared ?wallet=
// link still shows the pill lit and offers a one-tap way back to all races.
export default function MyRacesFilter({ track, activeWallet }: { track: number | null; activeWallet: string | null }) {
  const address = useWalletAddress();
  const active = !!activeWallet;
  const trackQ = track ? `track=${track}` : "";

  // Off + connected: switch to my races (keep track). Off + disconnected: send to
  // Stable to connect. On: clear the wallet filter (keep track).
  let href: string;
  let disabled = false;
  if (active) {
    href = `/races${trackQ ? `?${trackQ}` : ""}`;
  } else if (address) {
    href = `/races?wallet=${address}${trackQ ? `&${trackQ}` : ""}`;
  } else {
    href = "/stable";
    disabled = true;
  }

  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      title={disabled ? "Connect your wallet to filter to races you entered" : undefined}
      className="transition-paddock rounded-full border px-3 py-1.5"
      style={active ? { borderColor: "var(--glow)", color: "var(--ink)" } : { borderColor: "var(--line)" }}
    >
      <span className={`type-micro uppercase tracking-wider ${active ? "text-ink" : "text-ink-faint"}`}>
        {disabled ? "My races · connect" : "My races"}
      </span>
    </Link>
  );
}
