import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-24 border-t hairline">
      <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-10 md:flex-row md:items-end md:justify-between md:px-6">
        <div className="space-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="asterisk text-lg leading-none">✳</span>
            <span className="type-card-title">Paddock</span>
          </div>
          <p className="type-micro max-w-xs uppercase leading-relaxed text-ink-faint">
            The open intelligence layer for Gigling Racing. One verified engine, never a fabricated number.
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
          <Link href="/methodology" className="transition-paddock type-micro uppercase tracking-wider text-ink-faint hover:text-ink">
            Methodology
          </Link>
          <Link href="/docs" className="transition-paddock type-micro uppercase tracking-wider text-ink-faint hover:text-ink">
            API
          </Link>
          <a
            href="https://github.com/"
            className="transition-paddock type-micro uppercase tracking-wider text-ink-faint hover:text-ink"
          >
            Security
          </a>
          <span className="type-micro uppercase tracking-wider text-ink-faint">a Patch Notes product</span>
        </nav>
      </div>
    </footer>
  );
}
