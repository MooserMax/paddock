import Link from "next/link";

// Designed, on-brand 404 that routes to the zero-friction demo paths instead of
// dead-ending. A judge who fat-fingers a URL still lands somewhere alive.
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-page flex-col items-center justify-center px-4 py-16 text-center">
      <p className="asterisk text-5xl">✳</p>
      <h1 className="type-page-title mt-4 text-ink">Off the track</h1>
      <p className="type-body mt-3 max-w-md text-ink-soft">
        That page is not in the paddock. Here is where the good stuff is.
      </p>
      <div className="mt-8 grid w-full max-w-md gap-3 sm:grid-cols-2">
        <DemoLink href="/pet/6249" label="A flagship dossier" hint="Gigling #6249" />
        <DemoLink href="/wallet" label="Try a demo stable" hint="full intelligence report" />
        <DemoLink href="/scanner" label="Scan a race" hint="the verdict engine" />
        <DemoLink href="/" label="Home" hint="start here" />
      </div>
    </div>
  );
}

function DemoLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="panel transition-paddock flex flex-col gap-0.5 p-4 text-left hover:border-line-strong"
    >
      <span className="type-data text-ink">{label}</span>
      <span className="type-micro uppercase text-ink-faint">{hint}</span>
    </Link>
  );
}
