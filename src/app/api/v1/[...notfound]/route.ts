import { notFound, preflight } from "@/lib/api/http";

export const dynamic = "force-dynamic";

// Unknown paths under /api/v1 return the JSON error envelope, never the SPA HTML
// 404. This is scoped to /api/v1 ONLY, so normal site routes (e.g. /pet/<garbage>,
// /totallyfake) still render the friendly HTML "Off the track" page via
// app/not-found.tsx.
//
// Why this does not shadow real endpoints: Next.js route precedence is
// static > dynamic > catch-all. Every defined endpoint (stats, leaderboard,
// races, scan, calibration, pet/[id], race/[id], wallet/[address],
// odds/race/[id], health) matches first; this catch-all only handles paths no
// route claims. It is the canonical App Router way to JSON-ify the API 404
// without a rewrite that runs before, or after, the real routes.
function unknownRoute() {
  return notFound("Unknown API route. See /docs for the available /api/v1 endpoints.");
}

export const GET = unknownRoute;
export const POST = unknownRoute;
export const PUT = unknownRoute;
export const PATCH = unknownRoute;
export const DELETE = unknownRoute;
export const HEAD = unknownRoute;

export function OPTIONS() {
  return preflight();
}
