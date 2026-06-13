import Link from "next/link";
import type { Metadata } from "next";
import ApiTryIt from "@/components/docs/ApiTryIt";
import Panel from "@/components/ui/Panel";

export const metadata: Metadata = {
  title: "API",
  description: "The Paddock API: read-only, public, versioned. Every number on this site comes from these endpoints, and so can yours.",
};

const ENDPOINTS = [
  { method: "GET", path: "/pet/6249", title: "Pet dossier", desc: "Full dossier: honest stat ranges, traits with study lifts, confirmed quality, upside, shark profile, valuation band." },
  { method: "GET", path: "/wallet/0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30", title: "Wallet summary", desc: "Stable report: A-team, hidden gems, reveal queue, track assignments, estimated value, flags." },
  { method: "GET", path: "/race/5667", title: "Race + scanner verdict", desc: "Entrants with records and ELO, payout structure, and the scanner verdict object." },
  { method: "GET", path: "/odds/race/5667", title: "Odds", desc: "Per-entrant win probabilities from the model. Calibrated out of sample at /calibration." },
  { method: "GET", path: "/leaderboard?metric=cq&limit=10", title: "Leaderboard", desc: "Ranked by cq, elo, winrate (shrunk), or earnings. Paginated with limit and offset." },
  { method: "GET", path: "/scan?pets=6249,3010,1971,442&track=1200&mark=6249", title: "Live-lobby scan", desc: "A verdict for an ad-hoc field that is not a stored race. Mark your horse to check its fit." },
  { method: "GET", path: "/races?limit=10", title: "Races feed", desc: "Recent resolved races. Filter by track length." },
  { method: "GET", path: "/calibration", title: "Calibration", desc: "The odds model's out-of-sample backtest: split, metrics, and the predicted-vs-actual buckets." },
  { method: "GET", path: "/stats", title: "Site stats", desc: "Headline counts and the data freshness timestamps." },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-page px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">The open intelligence layer</p>
        <h1 className="type-page-title mt-2 text-ink">The Paddock API</h1>
        <p className="type-body mt-3 text-ink-soft">
          Read-only, public, versioned at <code className="type-data text-ink">/api/v1</code>, CORS open. Every number on this site is served by these endpoints, and the same door is open to anyone building on Gigling Racing. Honest data holds in JSON exactly as in the UI: unrevealed stats are ranges with flags, never midpoints; thin comps say thin.
        </p>
      </header>

      {/* The mic-drop: the full #6249 dossier, live, on landing. */}
      <Panel eyebrow="Start here" title="The whole dossier for Gigling #6249, in one call" className="mb-10" note="This runs on load. Every value on that horse's page comes from exactly this response.">
        <ApiTryIt path="/pet/6249" hero />
      </Panel>

      <h2 className="type-section mb-4 text-ink">Every endpoint</h2>
      <div className="space-y-6">
        {ENDPOINTS.map((e) => (
          <div key={e.path}>
            <div className="mb-2 flex items-baseline gap-3">
              <span className="type-micro rounded border hairline px-1.5 py-0.5 uppercase" style={{ color: "var(--green)" }}>{e.method}</span>
              <h3 className="type-card-title text-ink">{e.title}</h3>
            </div>
            <p className="type-micro mb-2 normal-case text-ink-faint">{e.desc}</p>
            <ApiTryIt path={e.path} />
          </div>
        ))}
      </div>

      <Panel eyebrow="Contract" title="What you can rely on" className="mt-10">
        <ul className="space-y-2">
          {[
            "Versioned path (/api/v1) from day one; breaking changes get a new version.",
            "Consistent error envelope { error: { code, message } } with correct HTTP status (400, 404, 429, 500), never a 200 wrapping an error.",
            "Per-IP rate limiting returns 429 with Retry-After, so the API stays up under load.",
            "Cache-Control tuned to the ingest cadence; reads are aggressively cacheable.",
            "Honest data in JSON: unrevealed stats are ranges with reveal flags, valuation bands carry a comp count and a thin flag.",
          ].map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="asterisk mt-0.5 leading-none">✳</span>
              <span className="type-data text-ink-soft">{t}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="type-micro mt-8 normal-case text-ink-faint">
        How the numbers are computed and validated is on the{" "}
        <Link href="/methodology" className="underline transition-paddock hover:text-glow">methodology page</Link>.
      </p>
    </div>
  );
}
