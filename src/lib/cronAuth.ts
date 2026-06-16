import { NextResponse } from "next/server";
import { env } from "./env";

// The shared secret may arrive two ways, so both Vercel's own cron and a plain
// external scheduler (cron-job.org) can authenticate without ever putting the
// secret in the URL:
//   Authorization: Bearer <CRON_SECRET>   (what Vercel cron sends)
//   x-cron-secret: <CRON_SECRET>          (simple custom header for externals)
// Anything else is rejected 401.
export function requireCron(req: Request): NextResponse | null {
  const secret = env("CRON_SECRET");
  const bearerOk = req.headers.get("authorization") === `Bearer ${secret}`;
  const headerOk = req.headers.get("x-cron-secret") === secret;
  if (!bearerOk && !headerOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
