"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

// Persistent cream/dark toggle. The no-flash script in the root layout sets the
// initial attribute before paint; this only reflects and updates it.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("paddock-theme", next);
    } catch {
      // storage unavailable; the toggle still works for this session
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "cream" : "dark"} theme`}
      aria-pressed={theme === "light"}
      className="transition-paddock inline-flex h-9 w-9 items-center justify-center rounded-md border hairline text-ink-soft hover:text-ink hover:border-line-strong"
      title="Toggle theme"
    >
      {/* Sun in dark mode (tap for light), moon in light mode. Hidden until mounted to avoid mismatch. */}
      <span className="text-base leading-none" aria-hidden>
        {mounted ? (theme === "dark" ? "◐" : "◑") : "◐"}
      </span>
    </button>
  );
}
