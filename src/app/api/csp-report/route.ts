import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// CSP violation sink. The Content-Security-Policy-Report-Only header points
// report-uri here so a real browser AGW/Privy connect session surfaces the exact
// dynamic origins the wallet flow contacts (Privy builds subdomains at runtime that
// a static source grep cannot enumerate). Those collected origins are the input to
// the enforced connect-src/frame-src allowlist. This is outside /api/v1 so it does
// not touch the versioned catch-all contract. It stores nothing sensitive and only
// logs the blocked directive and uri, never request bodies or wallet data.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    // Both the legacy report-uri shape ({ "csp-report": {...} }) and the
    // report-to shape (an array of { body: {...} }) are accepted.
    const report = body?.["csp-report"] ?? (Array.isArray(body) ? body[0]?.body : body) ?? {};
    const blocked = report["blocked-uri"] ?? report.blockedURL ?? "unknown";
    const directive = report["violated-directive"] ?? report.effectiveDirective ?? "unknown";
    const document = report["document-uri"] ?? report.documentURL ?? "unknown";
    // Structured, greppable, and non-sensitive (no request bodies, no PII). A live
    // connect+sign session reads these from the Vercel runtime logs to enumerate
    // every origin the wallet flow needs before enforcing.
    console.warn(`[csp-report] ${new Date().toISOString()} directive=${directive} blocked=${blocked} document=${document}`);
  } catch {
    // Never fail a report submission.
  }
  return new NextResponse(null, { status: 204 });
}
