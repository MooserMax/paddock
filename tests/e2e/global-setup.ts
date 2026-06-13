import { request } from "@playwright/test";

// Next.js dev compiles a route on its first request, so a cold route can exceed
// a test's timeout and flake. This warms every route under test (pages, API,
// og images) sequentially before any test runs, so tests only ever hit compiled
// routes. Against a production build this is a no-op cost. The signing-path tests
// in particular must never flake, so their routes are warmed here too.
const WALLET = "0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30";

const ROUTES = [
  "/",
  "/pet/6249",
  "/pet/99999999",
  "/wallet/" + WALLET,
  "/wallet/not-an-address",
  "/scanner",
  "/scanner?race=5667&mark=6249",
  "/race/5667",
  "/races",
  "/calibration",
  "/leaderboards",
  "/methodology",
  "/docs",
  "/auto-racer",
  "/api/v1/pet/6249",
  "/api/v1/race/5667",
  "/api/v1/race/6368",
  "/api/v1/wallet/" + WALLET,
  "/api/v1/odds/race/4000",
  "/api/v1/leaderboard?metric=cq&limit=5",
  "/api/v1/calibration",
  "/api/v1/races?limit=5",
  "/api/v1/scan?pets=6249,3010,1971&track=1200&mark=6249",
  "/api/v1/stats",
  "/api/autoracer/simulate?race=5667&pet=6249",
  "/pet/6249/opengraph-image",
  "/wallet/" + WALLET + "/opengraph-image",
];

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: process.env.PADDOCK_URL || "http://localhost:3002" });
  for (const route of ROUTES) {
    // Await each so the route is fully compiled before the suite starts.
    await ctx.get(route, { timeout: 60_000 }).catch(() => {});
  }
  await ctx.dispose();
}
