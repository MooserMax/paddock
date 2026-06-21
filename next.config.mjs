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
};

export default nextConfig;
