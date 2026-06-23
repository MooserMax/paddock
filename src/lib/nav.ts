// The single source of truth for primary navigation. The nav and footer derive
// from this, so a surface that has not shipped renders as visibly disabled, never
// as a dead link. Flip `ready` to true only when the route actually exists. An
// e2e test asserts every rendered nav LINK returns 200, so a late cut that leaves
// `ready: true` on a missing route fails CI rather than shipping a 404.
export interface NavRoute {
  href: string;
  label: string;
  ready: boolean;
}

// Primary top-level bar. Wallet stays top-level on purpose: it looks up ANY
// player's stable by address, distinct from the connected user's own Stable
// (which appears as a top-level item only when a wallet is connected, see
// StableNavItem). Odds, Methodology, and API moved under the Docs dropdown.
export const NAV_ROUTES: NavRoute[] = [
  { href: "/wallet", label: "Wallet", ready: true },
  { href: "/races", label: "Races", ready: true },
  { href: "/race-finder", label: "Race Finder", ready: true },
  { href: "/scanner", label: "Scanner", ready: true },
  { href: "/leaderboards", label: "Leaderboards", ready: true },
  { href: "/records", label: "Records", ready: true },
];

// Grouped under the "Docs" dropdown, the first grouped nav element.
export const DOCS_ROUTES: NavRoute[] = [
  { href: "/calibration", label: "Odds", ready: true },
  { href: "/methodology", label: "Methodology", ready: true },
  { href: "/docs", label: "API", ready: true },
];
