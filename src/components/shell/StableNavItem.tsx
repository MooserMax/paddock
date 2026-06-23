"use client";

import NavLink from "./NavLink";
import { useWalletConnected } from "@/lib/walletFlag";

// Top-level Stable link, shown only when a wallet is connected, so the user's own
// horses and live race are one click from anywhere. No wallet, no item.
export default function StableNavItem() {
  const connected = useWalletConnected();
  if (!connected) return null;
  return <NavLink href="/stable">Stable</NavLink>;
}
