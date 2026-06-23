"use client";

import { AbstractWalletProvider } from "@abstract-foundation/agw-react";
import { abstract } from "viem/chains";

// Scopes the wagmi + AGW context to the Race Finder only. The AbstractWalletProvider
// sets up WagmiProvider and QueryClientProvider internally on Abstract mainnet
// (chainId 2741). The AGW connector is primary; wagmi's EIP-6963 discovery surfaces
// injected wallets (MetaMask) as the fallback, so both wallet paths live in one
// config. Read-only intelligence renders with no wallet and never enters this tree.
export default function WalletProvider({ children }: { children: React.ReactNode }) {
  return <AbstractWalletProvider chain={abstract}>{children}</AbstractWalletProvider>;
}
