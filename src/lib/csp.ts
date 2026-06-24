// Single source of truth for the Content-Security-Policy. The proxy builds the
// header from this (with a per-request nonce) and the root layout reads the same
// nonce to tag its inline script, so the policy and the nonce never drift.
//
// Security win of this phase: script-src has NO 'unsafe-inline'. It uses a per
// request nonce plus 'strict-dynamic', so the nonced bootstrap can load the app's
// own same-origin chunks while any injected inline script is blocked. style-src
// keeps 'unsafe-inline' on purpose: inline style attributes are pervasive and far
// lower risk than script injection, and removing them would break the app for no
// meaningful gain. The other directives match the verified Report-Only allowlist.

// ONE-FLAG ROLLBACK: 'enforce' sends Content-Security-Policy; 'report-only' sends
// Content-Security-Policy-Report-Only (the policy is identical, only the header
// name and blocking behavior change). To roll back, set this to 'report-only' and
// redeploy: one constant, one commit.
type CspMode = "enforce" | "report-only";
export const CSP_MODE = "report-only" as CspMode;

export const CSP_HEADER_NAME =
  CSP_MODE === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // No 'unsafe-inline' for scripts. Nonce + strict-dynamic: the nonced bootstrap
    // loads the rest; unnonced inline scripts are blocked.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline styles kept (low risk, pervasive); not the security target here.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.mypinata.cloud https://i.seadn.io https://*.seadn.io",
    "font-src 'self' data:",
    // The Abstract RPC plus the AGW/Privy auth origins the wallet flow contacts.
    // Wildcards kept because Privy rotates subdomains; Step 1's live connect+sign
    // session confirms whether anything beyond these is needed before enforcing.
    "connect-src 'self' https://api.mainnet.abs.xyz https://*.abs.xyz https://auth.privy.io https://*.privy.io wss://*.privy.io",
    "frame-src 'self' https://auth.privy.io https://*.privy.io https://*.abs.xyz",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}
