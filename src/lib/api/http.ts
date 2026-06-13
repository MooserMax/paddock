import { NextResponse } from "next/server";
import type { ApiError } from "./types";

// Consistent response helpers for /api/v1. Success carries tuned Cache-Control
// (reads are not realtime; aggressive caching also shields the API under
// judging load). Errors always use the { error: { code, message } } envelope
// with a correct status code, never a 200 wrapping a failure.

const CORS_HEADERS: Record<string, string> = {
  // Reads are public so other builders can build on the engine.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export interface OkOptions {
  // Seconds. s-maxage drives the CDN; stale-while-revalidate keeps it warm.
  sMaxAge?: number;
  staleWhileRevalidate?: number;
  etag?: string;
  extraHeaders?: Record<string, string>;
}

export function ok<T>(data: T, opts: OkOptions = {}): NextResponse {
  const sMaxAge = opts.sMaxAge ?? 60;
  const swr = opts.staleWhileRevalidate ?? sMaxAge * 10;
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
    ...opts.extraHeaders,
  };
  if (opts.etag) headers["ETag"] = opts.etag;
  return NextResponse.json(data, { headers });
}

export function fail(
  code: string,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>
): NextResponse {
  const body: ApiError = { error: { code, message } };
  return NextResponse.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...extraHeaders },
  });
}

export const badRequest = (m: string) => fail("bad_request", m, 400);
export const notFound = (m: string) => fail("not_found", m, 404);
export const serverError = (m: string) => fail("server_error", m, 500);

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Wrap a handler so any thrown error becomes a clean 500 envelope, never an
// uncaught stack trace leaking to the client.
export function guard(
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  return handler().catch((err) => {
    const message = err instanceof Error ? err.message : "unexpected error";
    return serverError(message);
  });
}
