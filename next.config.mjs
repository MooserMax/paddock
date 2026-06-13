/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.mypinata.cloud" },
      { protocol: "https", hostname: "i.seadn.io" },
      { protocol: "https", hostname: "*.seadn.io" },
    ],
  },
};

export default nextConfig;
