import Link from "next/link";
import NavLink from "./NavLink";
import NavDropdown from "./NavDropdown";
import ThemeToggle from "./ThemeToggle";
import CommandTrigger from "./CommandTrigger";
import DocsDropdown from "./DocsDropdown";
import StableNavItem from "./StableNavItem";
import WalletPill from "./WalletPill";
import { NAV_GROUPS, WALLET_ROUTE } from "@/lib/nav";

export default function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b hairline" style={{ background: "color-mix(in srgb, var(--paper) 82%, transparent)", backdropFilter: "blur(12px)" }}>
      <nav className="mx-auto flex h-14 max-w-page items-center justify-between gap-4 px-4 md:px-6" aria-label="Primary">
        <Link href="/" className="group flex items-baseline gap-1.5" aria-label="Paddock home">
          <span className="asterisk text-xl leading-none transition-paddock group-hover:rotate-90" style={{ display: "inline-block" }}>
            ✳
          </span>
          <span className="type-card-title tracking-tight">Paddock</span>
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {/* Consolidated: Races and Intel dropdowns, then the direct Wallet link. Every
              destination stays reachable here and in the command palette (the mobile path). */}
          {NAV_GROUPS.map((g) => (
            <NavDropdown key={g.label} label={g.label} routes={g.routes} />
          ))}
          <NavLink href={WALLET_ROUTE.href}>{WALLET_ROUTE.label}</NavLink>
          {/* Stable, shown only when a wallet is connected. */}
          <StableNavItem />
          {/* Docs dropdown groups Odds, Methodology, API. */}
          <DocsDropdown />
        </div>

        <div className="flex items-center gap-2">
          <CommandTrigger />
          <ThemeToggle />
          <WalletPill />
        </div>
      </nav>
    </header>
  );
}
