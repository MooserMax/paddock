import { NextResponse } from "next/server";
import { env } from "./env";

// Vercel cron invocations send "Authorization: Bearer ${CRON_SECRET}" when the
// CRON_SECRET env var is set on the project. Manual runs must send the same.
export function requireCron(req: Request): NextResponse | null {
  if (req.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
