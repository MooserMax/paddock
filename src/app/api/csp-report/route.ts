import { NextRequest, NextResponse } from "next/server";
import { getSyncState, setSyncState } from "@/lib/syncState";
import { requireCron } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

// CSP violation sink. The Content-Security-Policy-Report-Only header points
// report-uri here so a real browser AGW/Privy connect+sign session surfaces the
// exact dynamic origins the wallet flow contacts (Privy builds subdomains at runtime
// that a static source grep cannot enumerate). Those collected origins are the input
// to the enforced connect-src/frame-src allowlist. Outside /api/v1 so it does not
// touch the versioned catch-all. Logs and persists only the directive and uri
// fields, never request bodies or wallet data.
//
// POST accepts BOTH current report shapes (Report-Only Chrome sends either):
//   - legacy report-uri: content-type application/csp-report, body { "csp-report": {...} }
//   - report-to / Reporting API: content-type application/reports+json, body is an
//     ARRAY of { type, age, url, body: {...} }, possibly batching several. Every
//     element is processed, not just the first.
//
// Durability: each violation is also persisted through the existing syncState/db
// layer (a single jsonb blob under one key, no new table), so reports survive past
// the short Vercel function-log window and Scott can read them on his own schedule.
// GET returns them as JSON, gated by the same CRON_SECRET the internal cron routes
// use, so the collected origins are never publicly exposed.

const STORE_KEY = "csp_reports_v1";
const MAX_STORED = 500; // rolling cap, keep most recent; bounds the blob size
const MAX_PER_REQUEST = 50; // one POST contributes at most this many, flood guard

interface CspRecord {
  ts: string;
  disposition: string;
  directive: string;
  blocked: string;
  document: string;
}
interface CspStore {
  reports: CspRecord[];
}

type Report = Record<string, unknown>;

function toRecord(r: Report): CspRecord {
  return {
    ts: new Date().toISOString(),
    disposition: String(r["disposition"] ?? "report"),
    directive: String(r["violated-directive"] ?? r["effectiveDirective"] ?? "unknown"),
    blocked: String(r["blocked-uri"] ?? r["blockedURL"] ?? "unknown"),
    document: String(r["document-uri"] ?? r["documentURL"] ?? "unknown"),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const raw: Report[] = [];
    if (Array.isArray(body)) {
      for (const item of body) {
        const r = (item && typeof item === "object" && "body" in item ? (item as { body?: Report }).body : item) as Report | undefined;
        if (r && typeof r === "object") raw.push(r);
      }
    } else if (body && typeof body === "object") {
      const legacy = (body as { "csp-report"?: Report })["csp-report"];
      raw.push(legacy && typeof legacy === "object" ? legacy : (body as Report));
    }

    // Cap per request, then map every element (the batched path persists ALL of them).
    const records = raw.slice(0, MAX_PER_REQUEST).map(toRecord);
    for (const rec of records) {
      // Keep the live-tail line too.
      console.warn(`[csp-report] ${rec.ts} disposition=${rec.disposition} directive=${rec.directive} blocked=${rec.blocked} document=${rec.document}`);
    }

    if (records.length > 0) {
      // Persist durably. Read-modify-write on one jsonb row; report volume in a
      // collection session is low, and the rolling cap bounds the blob. A rare
      // concurrent lost-update only drops a duplicate, the distinct origin set is
      // what matters and that survives.
      try {
        const store = (await getSyncState<CspStore>(STORE_KEY)) ?? { reports: [] };
        const merged = [...store.reports, ...records].slice(-MAX_STORED);
        await setSyncState(STORE_KEY, { reports: merged } satisfies CspStore);
      } catch {
        // Persistence failure must never fail the report submission.
      }
    }
  } catch {
    // Never fail a report submission.
  }
  return new NextResponse(null, { status: 204 });
}

// Authenticated read of the collected reports. Same secret pattern as the cron
// routes (Authorization: Bearer <CRON_SECRET> or x-cron-secret). ?reset=1 clears the
// store, so Scott can start a session clean.
export async function GET(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;

  if (req.nextUrl.searchParams.get("reset") === "1") {
    await setSyncState(STORE_KEY, { reports: [] } satisfies CspStore);
    return NextResponse.json({ ok: true, cleared: true, count: 0, distinctBlocked: [], reports: [] });
  }

  const store = (await getSyncState<CspStore>(STORE_KEY)) ?? { reports: [] };
  const distinctBlocked = [...new Set(store.reports.map((r) => `${r.directive} ${r.blocked}`))].sort();
  return NextResponse.json({ ok: true, count: store.reports.length, distinctBlocked, reports: store.reports });
}
