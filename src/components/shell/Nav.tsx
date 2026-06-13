import Link from "next/link";
import NavLink from "./NavLink";
import ThemeToggle from "./ThemeToggle";
import CommandTrigger from "./CommandTrigger";

const LINKS = [
  { href: "/wallet", label: "Wallet" },
  { href: "/races", label: "Races" },
  { href: "/scanner", label: "Scanner" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/calibration", label: "Odds" },
  { href: "/methodology", label: "Methodology" },
  { href: "/docs", label: "API" },
];

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
          {LINKS.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <CommandTrigger />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
