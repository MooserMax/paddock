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

export const NAV_ROUTES: NavRoute[] = [
  { href: "/wallet", label: "Wallet", ready: true },
  { href: "/races", label: "Races", ready: true },
  { href: "/scanner", label: "Scanner", ready: true },
  { href: "/leaderboards", label: "Leaderboards", ready: false },
  { href: "/calibration", label: "Odds", ready: false },
  { href: "/methodology", label: "Methodology", ready: false },
  { href: "/docs", label: "API", ready: false },
];
