"use client";

import { useState, useEffect } from "react";

// A tiny localStorage flag for "a wallet is connected", so the global nav can show
// the Stable item without pulling the whole wagmi/AGW provider (and its bundle)
// onto every page. The ConnectBar, which already lives inside the wallet provider,
// writes this on connect/disconnect; nav islands read it. A stale flag is harmless:
// clicking Stable while not actually connected just shows the connect/paste prompt.
const KEY = "paddock:wallet";

export function setWalletFlag(address: string | null): void {
  try {
    if (address) localStorage.setItem(KEY, address.toLowerCase());
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("paddock:wallet"));
  } catch {
    // storage unavailable (private mode, etc.); the nav simply will not show Stable
  }
}

// The connected address (lowercased) from the same flag, or null. Lets a light
// client island filter to "my races" without pulling in the wagmi/AGW provider.
export function useWalletAddress(): string | null {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        setAddr(localStorage.getItem(KEY));
      } catch {
        setAddr(null);
      }
    };
    read();
    window.addEventListener("paddock:wallet", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("paddock:wallet", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return addr;
}

export function useWalletConnected(): boolean {
  // Starts false on the server and the first client render, so there is no
  // hydration mismatch; the effect flips it true after mount when the flag is set.
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setConnected(!!localStorage.getItem(KEY));
      } catch {
        setConnected(false);
      }
    };
    read();
    window.addEventListener("paddock:wallet", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("paddock:wallet", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return connected;
}
