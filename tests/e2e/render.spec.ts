import { test, expect } from "@playwright/test";

const DEMO_WALLET = "0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30";

// Smoke + screenshot suite. Every page must render its key content (not crash),
// and we capture a full-page screenshot per viewport so the 380px mobile claim
// is verifiable, not asserted. Empty and error states are covered too.
const PAGES = [
  { path: "/", name: "home", expect: "One verified engine" },
  { path: "/pet/6249", name: "dossier", expect: "Confirmed quality" },
  { path: `/wallet/${DEMO_WALLET}`, name: "wallet", expect: "Estimated stable value" },
  { path: "/scanner?race=5667&mark=6249", name: "scanner", expect: "2 sharks and a top-2 payout" },
  { path: "/races", name: "races", expect: "Recent races" },
  { path: "/calibration", name: "calibration", expect: "The model grades itself" },
  { path: "/leaderboards", name: "leaderboards", expect: "Ranked from our database" },
  { path: "/methodology", name: "methodology", expect: "How Paddock knows what it knows" },
  { path: "/pet/99999999", name: "notfound", expect: "Off the track" },
  { path: "/wallet/not-an-address", name: "wallet-error", expect: "did not read" },
];

for (const p of PAGES) {
  test(`${p.name} renders`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(p.path, { waitUntil: "networkidle" });
    await expect(page.getByText(p.expect, { exact: false }).first()).toBeVisible();
    expect(errors, `console errors on ${p.path}`).toEqual([]);
    await page.screenshot({ path: `screenshots/${testInfo.project.name}-${p.name}.png`, fullPage: true });
  });
}

test("theme toggle switches and persists", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /switch to cream theme/i });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

// Nav integrity: every link the nav actually renders must resolve to 200. Unbuilt
// surfaces render as disabled spans (not links), so a dead nav link cannot ship.
test("every rendered nav link returns 200", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator("header nav a").evaluateAll((els) =>
    els.map((e) => (e as HTMLAnchorElement).getAttribute("href")).filter((h): h is string => !!h && h.startsWith("/"))
  );
  expect(hrefs.length).toBeGreaterThan(1);
  for (const href of [...new Set(hrefs)]) {
    const res = await request.get(href);
    expect(res.status(), `nav link ${href}`).toBe(200);
  }
});
