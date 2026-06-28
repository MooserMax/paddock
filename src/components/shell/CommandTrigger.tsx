"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletConnected } from "@/lib/walletFlag";

interface Cmd {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

// Every primary destination, so the palette is a complete index of the site. On mobile there
// is no link bar, so this list IS the navigation: it must cover every grouped destination.
const PAGES: { label: string; href: string; hint: string }[] = [
  { label: "Home", href: "/", hint: "page" },
  { label: "Wallet lookup", href: "/wallet", hint: "page" },
  { label: "Races", href: "/races", hint: "page" },
  { label: "Race Finder", href: "/race-finder", hint: "page" },
  { label: "Develop", href: "/develop", hint: "page" },
  { label: "Scanner", href: "/scanner", hint: "page" },
  { label: "Leaderboards", href: "/leaderboards", hint: "page" },
  { label: "Records", href: "/records", hint: "page" },
  { label: "Odds calibration", href: "/calibration", hint: "page" },
  { label: "Methodology", href: "/methodology", hint: "page" },
  { label: "API docs", href: "/docs", hint: "page" },
];

// Command palette: jump to any pet id, wallet, race id, or page. Keyboard-first
// and fully accessible. This single interaction reads "precision instrument."
export default function CommandTrigger() {
  const router = useRouter();
  const connected = useWalletConnected();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback((href: string) => { router.push(href); close(); }, [router, close]);

  // Global cmd-K / ctrl-K to open, Escape handled in the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const q = query.trim();
    const out: Cmd[] = [];
    if (/^\d+$/.test(q)) {
      out.push({ id: `pet-${q}`, label: `Open dossier for Gigling #${q}`, hint: "pet", run: () => go(`/pet/${q}`) });
      out.push({ id: `race-${q}`, label: `Open race #${q}`, hint: "race", run: () => go(`/race/${q}`) });
      out.push({ id: `scan-${q}`, label: `Scan race #${q}`, hint: "scanner", run: () => go(`/scanner?race=${q}`) });
    } else if (/^0x[0-9a-fA-F]{0,40}$/.test(q) && q.length > 2) {
      out.push({ id: `wallet-${q}`, label: `Look up wallet ${q}`, hint: "wallet", run: () => go(`/wallet/${q}`) });
    }
    const lc = q.toLowerCase();
    const pages = connected ? [{ label: "Your stable", href: "/stable", hint: "page" }, ...PAGES] : PAGES;
    for (const p of pages) {
      if (!q || p.label.toLowerCase().includes(lc)) {
        out.push({ id: `page-${p.href}`, label: p.label, hint: p.hint, run: () => go(p.href) });
      }
    }
    return out;
  }, [query, go, connected]);

  useEffect(() => { setActive(0); }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, commands.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); commands[active]?.run(); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette and navigation menu"
        className="transition-paddock inline-flex h-9 items-center gap-2 rounded-md border hairline px-2.5 text-ink-faint hover:text-ink hover:border-line-strong"
      >
        {/* On mobile this is the only navigation, so the trigger is always visible (an icon on
            phones, the labelled Search affordance on wider screens). */}
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="md:hidden">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M13.5 13.5 10.5 10.5" strokeLinecap="round" />
        </svg>
        <span className="type-micro hidden md:inline">Search</span>
        <kbd className="type-micro hidden rounded border hairline px-1 py-0.5 leading-none md:inline-block">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
          style={{ background: "color-mix(in srgb, var(--paper-sunken) 70%, transparent)" }}
          onClick={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="panel assemble w-full max-w-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Jump to a Gigling id, wallet, race, or page"
              aria-label="Command input"
              aria-controls="command-list"
              className="type-data w-full border-b hairline bg-transparent px-4 py-3.5 text-ink outline-none placeholder:text-ink-faint"
            />
            <ul ref={listRef} id="command-list" role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto py-1">
              {commands.length === 0 && (
                <li className="type-data px-4 py-3 text-ink-faint">No matches. Try a Gigling id or a 0x wallet.</li>
              )}
              {commands.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => c.run()}
                    className={`transition-paddock flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${
                      i === active ? "text-ink" : "text-ink-soft"
                    }`}
                    style={i === active ? { background: "var(--paper-sunken)" } : undefined}
                  >
                    <span className="type-data">{c.label}</span>
                    <span className="type-micro uppercase text-ink-faint">{c.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
