"use client";

import { useWalletAddress } from "@/lib/walletFlag";
import LiveRaces from "@/components/wallet/LiveRaces";

// Surfaces the shared LiveRaces tracker on the Races tab for the CONNECTED wallet (read
// from the lightweight flag, no wallet provider needed here). Reuses the exact component
// and /api/v1/wallet/<addr>/live-races endpoint used on the Wallet page; renders nothing
// when disconnected or when the wallet has no in-flight races.
export default function ConnectedLiveRaces() {
  const address = useWalletAddress();
  if (!address) return null;
  return <LiveRaces wallet={address} />;
}
