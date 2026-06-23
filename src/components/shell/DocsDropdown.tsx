"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { DOCS_ROUTES } from "@/lib/nav";

// The Docs dropdown groups Odds, Methodology, and API. Matches nav styling exactly
// (JetBrains Mono uppercase, ink-faint, the glow active underline, flat hairline
// panel, no shadow). Keyboard accessible: the trigger is a real button (Enter and
// Space toggle), Escape closes, the menu items are focusable links. Desktop only;
// the nav collapses to the command palette on mobile, which already lists these.
export default function DocsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const active = DOCS_ROUTES.some((r) => pathname.startsWith(r.href));

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
        Docs
        {active && <span className="absolute -bottom-2 left-0 h-px w-full" style={{ background: "var(--glow)" }} aria-hidden />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-3 min-w-[10rem] rounded-md border p-1 hairline" style={{ background: "var(--paper)" }}>
          {DOCS_ROUTES.map((r) => (
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
