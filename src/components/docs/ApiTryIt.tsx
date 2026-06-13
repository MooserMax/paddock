"use client";

import { useEffect, useState } from "react";

// A live, runnable API example: the copy-paste curl and a "Run it" button that
// hits the real endpoint and renders the JSON in place. The site's own API,
// provable in one click.
export default function ApiTryIt({ path, hero = false }: { path: string; hero?: boolean }) {
  const [origin, setOrigin] = useState("");
  const [body, setBody] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setOrigin(window.location.origin); }, []);

  // Post-mount this is the real deployed origin so a copied curl works in prod;
  // the pre-hydration fallback honors the configured site URL.
  const curl = `curl ${origin || process.env.NEXT_PUBLIC_SITE_URL || "https://paddock.bot"}/api/v1${path}`;

  async function run() {
    setLoading(true);
    setBody(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/v1${path}`);
      setStatus(res.status);
      const json = await res.json();
      setBody(JSON.stringify(json, null, 2));
    } catch {
      setBody("Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; the text is still selectable
    }
  }

  // The hero example runs itself on mount so the page lands on live JSON.
  useEffect(() => { if (hero) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hero]);

  return (
    <div className="overflow-hidden rounded-lg border hairline">
      <div className="flex items-center gap-2 border-b hairline px-3 py-2" style={{ background: "var(--paper-sunken)" }}>
        <code className="type-data flex-1 overflow-x-auto whitespace-nowrap text-ink-soft">{curl}</code>
        <button
          type="button"
          onClick={copy}
          className="transition-paddock shrink-0 rounded border hairline px-2 py-1 text-ink-faint hover:text-ink hover:border-line-strong"
        >
          <span className="type-micro uppercase">{copied ? "copied" : "copy"}</span>
        </button>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="transition-paddock shrink-0 rounded px-2.5 py-1"
          style={{ background: "var(--action)", color: "#14110f", opacity: loading ? 0.6 : 1 }}
        >
          <span className="type-micro uppercase">{loading ? "running" : "run it"}</span>
        </button>
      </div>

      {(body || loading) && (
        <div className="relative">
          {status !== null && (
            <span className="type-micro absolute right-3 top-2 uppercase" style={{ color: status < 400 ? "var(--green)" : "var(--glow)" }}>
              {status} {status < 400 ? "ok" : "error"}
            </span>
          )}
          <pre className={`overflow-auto px-3 py-3 ${hero ? "max-h-96" : "max-h-72"}`} style={{ background: "var(--paper-raised)" }}>
            <code className="type-data leading-relaxed text-ink-soft">{loading ? "loading..." : body}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
