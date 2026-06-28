"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { NavRoute } from "@/lib/nav";

// A grouped top-level nav dropdown (Races, Intel, Docs). One accessible implementation,
// reused so every group behaves identically. Matches nav styling exactly (JetBrains Mono
// uppercase, ink-faint, glow active underline, flat hairline panel, no shadow). Keyboard
// accessible: the trigger is a real button (Enter and Space toggle), Escape closes, outside
// click and blur close, items are focusable links with role=menuitem. Desktop only; the nav
// collapses to the command palette on mobile, which lists every one of these destinations.
export default function NavDropdown({ label, routes, align = "left" }: { label: string; routes: NavRoute[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const active = routes.some((r) => pathname === r.href || pathname.startsWith(r.href + "/"));

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`transition-paddock relative type-micro uppercase tracking-wider ${active ? "text-ink" : "text-ink-faint hover:text-ink-soft"}`}
      >
        {label}
        {active && <span className="absolute -bottom-2 left-0 h-px w-full" style={{ background: "var(--glow)" }} aria-hidden />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute top-full z-50 mt-3 min-w-[10rem] rounded-md border p-1 hairline ${align === "right" ? "right-0" : "left-0"}`}
          style={{ background: "var(--paper)" }}
        >
          {routes.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="transition-paddock block rounded px-3 py-2 type-micro uppercase tracking-wider text-ink-faint hover:bg-paper-raised hover:text-ink"
            >
              {r.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
