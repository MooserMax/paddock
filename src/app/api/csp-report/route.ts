import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// CSP violation sink. The Content-Security-Policy-Report-Only header points
// report-uri here so a real browser AGW/Privy connect+sign session surfaces the
// exact dynamic origins the wallet flow contacts (Privy builds subdomains at runtime
// that a static source grep cannot enumerate). Those collected origins are the input
// to the enforced connect-src/frame-src allowlist. Outside /api/v1 so it does not
// touch the versioned catch-all. It logs only the directive and uri fields, never
// request bodies or wallet data.
//
// Accepts BOTH current report shapes, since Report-Only Chrome sends either:
//   - legacy report-uri: content-type application/csp-report, body { "csp-report": {...} }
//   - report-to / Reporting API: content-type application/reports+json, body is an
//     ARRAY of { type, age, url, body: {...} }, and a single POST may batch several.
// Field names also differ (kebab-case for legacy, camelCase for report-to), so both
// are read.

type Report = Record<string, unknown>;

function logReport(r: Report): void {
  const blocked = r["blocked-uri"] ?? r["blockedURL"] ?? "unknown";
  const directive = r["violated-directive"] ?? r["effectiveDirective"] ?? "unknown";
  const document = r["document-uri"] ?? r["documentURL"] ?? "unknown";
  const disposition = r["disposition"] ?? "report"; // report-only vs enforce
  // Structured, greppable, non-sensitive. Pull these with a [csp-report] grep.
  console.warn(`[csp-report] ${new Date().toISOString()} disposition=${disposition} directive=${directive} blocked=${blocked} document=${document}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const reports: Report[] = [];
    if (Array.isArray(body)) {
      // report-to: every element, batched or not. Each carries the violation in
      // .body; tolerate an element that is already the violation object.
      for (const item of body) {
        const r = (item && typeof item === "object" && "body" in item ? (item as { body?: Report }).body : item) as Report | undefined;
        if (r && typeof r === "object") reports.push(r);
      }
    } else if (body && typeof body === "object") {
      const legacy = (body as { "csp-report"?: Report })["csp-report"];
      reports.push(legacy && typeof legacy === "object" ? legacy : (body as Report));
    }
    for (const r of reports) logReport(r);
  } catch {
    // Never fail a report submission.
  }
  return new NextResponse(null, { status: 204 });
}
