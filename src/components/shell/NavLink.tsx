"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Active-aware nav link. A section is active when the path matches or nests
// under its href (so /pet/6249 lights nothing, but /races lights Races).
export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`transition-paddock relative type-micro uppercase tracking-wider ${
        active ? "text-ink" : "text-ink-faint hover:text-ink-soft"
      }`}
    >
      {children}
      {active && (
        <span className="absolute -bottom-2 left-0 h-px w-full" style={{ background: "var(--glow)" }} aria-hidden />
      )}
    </Link>
  );
}
