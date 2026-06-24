import { NextRequest, NextResponse } from "next/server";
import { buildCsp, CSP_HEADER_NAME } from "@/lib/csp";

// Per-request nonce CSP. Next 16 renamed middleware to proxy (nodejs runtime). This
// generates a fresh nonce each request, builds the policy from the single source in
// lib/csp.ts, sets the nonce on the REQUEST headers (x-nonce) so the root layout can
// tag its inline script and Next can tag its bootstrap scripts, and on the RESPONSE
// header as the CSP. Using a per-request nonce opts pages into dynamic rendering,
// the accepted tradeoff for removing script 'unsafe-inline'.
export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CSP_HEADER_NAME, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER_NAME, csp);
  return response;
}

export const config = {
  // Run on documents only; skip static assets, images, and the CSP report sink
  // itself so report POSTs are never policed.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|api/csp-report|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
