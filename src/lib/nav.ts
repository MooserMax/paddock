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

// The individual destinations. Wallet stays a direct top-level link on purpose: it looks up
// ANY player's stable by address, distinct from the connected user's own Stable (which appears
// as a top-level item only when a wallet is connected, see StableNavItem).
const WALLET: NavRoute = { href: "/wallet", label: "Wallet", ready: true };
const RACES: NavRoute = { href: "/races", label: "Races", ready: true };
const RACE_FINDER: NavRoute = { href: "/race-finder", label: "Race Finder", ready: true };
const DEVELOP: NavRoute = { href: "/develop", label: "Develop", ready: true };
const DUEL: NavRoute = { href: "/duel", label: "Duel", ready: true };
const SCANNER: NavRoute = { href: "/scanner", label: "Scanner", ready: true };
const LEADERBOARDS: NavRoute = { href: "/leaderboards", label: "Leaderboards", ready: true };
const RECORDS: NavRoute = { href: "/records", label: "Records", ready: true };

// Flat list of every primary destination. The footer and the e2e link check derive from this,
// so it stays complete; grouping into dropdowns is a presentation concern only (no route
// added or removed, no URL changed).
export const NAV_ROUTES: NavRoute[] = [WALLET, RACES, RACE_FINDER, DEVELOP, DUEL, SCANNER, LEADERBOARDS, RECORDS];

// The top bar is consolidated into two dropdowns plus the direct Wallet link: nothing is
// removed, only grouped. Races = what you do with a race (incl. breeding via Duel); Intel = the
// analytical tools.
export interface NavGroup { label: string; routes: NavRoute[] }
export const NAV_GROUPS: NavGroup[] = [
  { label: "Races", routes: [RACES, RACE_FINDER, DEVELOP, DUEL] },
  { label: "Intel", routes: [SCANNER, LEADERBOARDS, RECORDS] },
];
export const WALLET_ROUTE: NavRoute = WALLET;

// Grouped under the "Docs" dropdown.
export const DOCS_ROUTES: NavRoute[] = [
  { href: "/calibration", label: "Odds", ready: true },
  { href: "/methodology", label: "Methodology", ready: true },
  { href: "/docs", label: "API", ready: true },
];
