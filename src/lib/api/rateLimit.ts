import { fail } from "./http";
import type { NextRequest } from "next/server";

// Lightweight per-IP token bucket. In-memory and per-instance, which is the
// right tradeoff here: it cannot fall over, needs no external store, and an
// API that survives a judging-day traffic spike beats a "perfect" one that
// hangs. A 429 carries Retry-After so clients back off instead of hammering.

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const CAPACITY = 60; // burst
const REFILL_PER_SEC = 10; // sustained requests per second per IP
const SWEEP_INTERVAL_MS = 5 * 60_000;

let lastSweep = 0;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [ip, b] of buckets) {
    if (now - b.updatedAt > SWEEP_INTERVAL_MS) buckets.delete(ip);
  }
}

// Returns null when allowed, or a 429 response when the caller must back off.
export function rateLimit(req: NextRequest): ReturnType<typeof fail> | null {
  const now = Date.now();
  sweep(now);
  const ip = clientIp(req);
  const bucket = buckets.get(ip) ?? { tokens: CAPACITY, updatedAt: now };

  const elapsedSec = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedSec * REFILL_PER_SEC);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil((1 - bucket.tokens) / REFILL_PER_SEC);
    buckets.set(ip, bucket);
    return fail("rate_limited", "Too many requests. Please slow down.", 429, {
      "Retry-After": String(Math.max(1, retryAfter)),
    });
  }

  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  return null;
}
