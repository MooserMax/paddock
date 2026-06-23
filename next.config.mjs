/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.mypinata.cloud" },
      { protocol: "https", hostname: "i.seadn.io" },
      { protocol: "https", hostname: "*.seadn.io" },
    ],
  },
  // Server-side (308 permanent) redirects so the guessable /odds web routes, which
  // the API path /api/v1/odds and the nav "Odds" label both invite, never dead-end
  // on the HTML 404. These are framework redirects, not client bounces, so the user
  // never sees "Off the track" en route. Scoped to /odds only: /api/v1/odds is a
  // different prefix and untouched, and unknown site routes still hit the HTML 404.
  async redirects() {
    return [
      // Per-race odds live in the scanner, which already renders that race's
      // per-horse predictions and verdict. The id carries through.
      { source: "/odds/race/:id", destination: "/scanner?race=:id", permanent: true },
      // Bare /odds matches where the nav "Odds" link resolves.
      { source: "/odds", destination: "/calibration", permanent: true },
    ];
  },

  // Security headers. The safe hardening headers are ENFORCED globally (they match
  // Gigaverse's HTTPS/HSTS floor and exceed it with nosniff, frame denial, and a
  // tight referrer policy). The CSP is staged in Report-Only so it can be validated
  // against real AGW/Privy signing traffic by the security review gate BEFORE it is
  // enforced; in report-only it cannot break the read-only board or the signing
  // path. The review then moves script-src to nonce-based 'self' and enforces.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.mypinata.cloud https://i.seadn.io https://*.seadn.io",
      "font-src 'self' data:",
      // Same-origin API plus the Abstract RPC and the AGW/Privy auth origins the
      // wallet client talks to from the browser. No other connect targets.
      "connect-src 'self' https://api.mainnet.abs.xyz https://*.abs.xyz https://auth.privy.io https://*.privy.io wss://*.privy.io",
      "frame-src 'self' https://auth.privy.io https://*.privy.io https://*.abs.xyz",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
