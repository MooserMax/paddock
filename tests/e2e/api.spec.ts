import { test, expect, type APIRequestContext } from "@playwright/test";

const DEMO_WALLET = "0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30";

async function getJson(request: APIRequestContext, path: string) {
  const res = await request.get(`/api/v1${path}`);
  return { res, body: await res.json() };
}

// =============================================================================
// #005667 SCANNER ACCEPTANCE TEST (the gate).
//
// Assertion table for race 5667 (the story race: 6249 finished 5th of 6):
//   trackLength        == 1200
//   payout is top-2    == true   ([6500, 3500], two paid positions)
//   recommendation     == "PASS"
//   payoutTrap         == true
//   sharkPetIds        ⊇ {20650, 25356}   (>= 2 sharks)
//   6249 is an entrant AND is NOT a shark
//   verdict.caveat is present (honest about real-time reveal/exhaustion)
// =============================================================================
test("#005667 acceptance: race 5667 reads PASS, two sharks, payout trap", async ({ request }) => {
  const { res, body } = await getJson(request, "/race/5667?mark=6249");
  expect(res.status()).toBe(200);

  expect(body.trackLength).toBe(1200);

  const paidPositions = (body.payoutBps as number[]).filter((b) => b > 0);
  expect(paidPositions.length, "payout is top-2 only").toBe(2);

  expect(body.verdict.recommendation).toBe("PASS");
  expect(body.verdict.payoutTrap).toBe(true);

  expect(body.verdict.sharkPetIds).toEqual(expect.arrayContaining([20650, 25356]));
  expect(body.verdict.sharkPetIds.length).toBeGreaterThanOrEqual(2);

  const entrant6249 = body.entrants.find((e: { petId: number }) => e.petId === 6249);
  expect(entrant6249, "6249 is in the field").toBeTruthy();
  expect(entrant6249.isShark, "6249 is not a shark").toBe(false);

  expect(typeof body.verdict.caveat).toBe("string");
  expect(body.verdict.caveat.length).toBeGreaterThan(20);
});

test("scanner counterexample: race 6368 reads ENTERABLE, no sharks", async ({ request }) => {
  const { res, body } = await getJson(request, "/race/6368");
  expect(res.status()).toBe(200);
  expect(body.verdict.recommendation).toBe("ENTERABLE");
  expect(body.verdict.sharkPetIds.length).toBe(0);
});

// =============================================================================
// SCHEMA SMOKE TESTS: every endpoint returns 200 with its key fields + types.
// =============================================================================
test("GET /pet/[id] schema", async ({ request }) => {
  const { res, body } = await getJson(request, "/pet/6249");
  expect(res.status()).toBe(200);
  expect(body.id).toBe(6249);
  expect(body.rarity.name).toBeTruthy();
  expect(body.stats.start).toHaveProperty("low");
  expect(body.stats.start).toHaveProperty("revealed");
  expect(Array.isArray(body.traits)).toBe(true);
  expect(typeof body.scores.confirmedQuality).toBe("number");
  expect(typeof body.shark.shrunkWinRate).toBe("number");
  expect(body.valuation).toHaveProperty("thin");
});

test("GET /wallet/[address] schema", async ({ request }) => {
  const { res, body } = await getJson(request, `/wallet/${DEMO_WALLET}`);
  expect(res.status()).toBe(200);
  expect(typeof body.petCount).toBe("number");
  expect(body.stableValue.estimated).toBe(true);
  expect(Array.isArray(body.aTeam)).toBe(true);
  expect(Array.isArray(body.trackAssignments)).toBe(true);
});

test("GET /race/[id] schema", async ({ request }) => {
  const { res, body } = await getJson(request, "/race/4000");
  expect(res.status()).toBe(200);
  expect(body.raceId).toBe(4000);
  expect(Array.isArray(body.entrants)).toBe(true);
  expect(body.verdict).toHaveProperty("recommendation");
  expect(typeof body.meta.eloThreshold).toBe("number");
});

test("GET /odds/race/[id] schema + probabilities sum to 1", async ({ request }) => {
  const { res, body } = await getJson(request, "/odds/race/4000");
  expect(res.status()).toBe(200);
  expect(body.modelVersion).toBe("odds-v1");
  expect(body.note).toContain("NOT yet calibrated");
  const sum = body.entrants.reduce((a: number, e: { winProbability: number }) => a + e.winProbability, 0);
  expect(sum).toBeCloseTo(1, 3);
});

test("GET /leaderboard schema (all metrics)", async ({ request }) => {
  for (const metric of ["cq", "elo", "winrate", "earnings"]) {
    const { res, body } = await getJson(request, `/leaderboard?metric=${metric}&limit=5`);
    expect(res.status(), metric).toBe(200);
    expect(body.metric).toBe(metric);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows[0]).toHaveProperty("rank");
    expect(body.rows[0]).toHaveProperty("shrunkWinRate");
  }
});

test("GET /races + /scan + /stats schemas", async ({ request }) => {
  const races = await getJson(request, "/races?limit=5");
  expect(races.res.status()).toBe(200);
  expect(Array.isArray(races.body.races)).toBe(true);

  const scan = await getJson(request, "/scan?pets=6249,3010,1971&track=1200&mark=6249");
  expect(scan.res.status()).toBe(200);
  expect(scan.body.verdict).toHaveProperty("recommendation");
  expect(scan.body.entrants.length).toBe(3);

  const stats = await getJson(request, "/stats");
  expect(stats.res.status()).toBe(200);
  expect(typeof stats.body.racesResolved).toBe("number");
});

// =============================================================================
// ERROR ENVELOPES: correct status codes, never a 200 wrapping an error.
// =============================================================================
test("error envelopes use correct status codes", async ({ request }) => {
  const bad = await request.get("/api/v1/pet/abc");
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe("bad_request");

  const missing = await request.get("/api/v1/pet/99999999");
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error.code).toBe("not_found");

  const badWallet = await request.get("/api/v1/wallet/notanaddress");
  expect(badWallet.status()).toBe(400);

  const badMetric = await request.get("/api/v1/leaderboard?metric=xyz");
  expect(badMetric.status()).toBe(400);
});
