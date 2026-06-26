import type { Metadata } from "next";
import { headers } from "next/headers";
import { Crimson_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/shell/Nav";
import Footer from "@/components/shell/Footer";
import WalletProvider from "@/components/racefinder/WalletProvider";

const crimson = Crimson_Pro({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Resolve the canonical origin so absolute og:image URLs are correct in prod.
// Vercel injects these automatically; falls back to the configured site URL.
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
  "https://paddock.bot";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Paddock — Gigling Racing intelligence",
    template: "%s — Paddock",
  },
  description:
    "The definitive tool for evaluating, valuing, and tracking every Gigling in Gigaverse Racing. Honest data: revealed values, explicit ranges, no fabricated stats.",
  applicationName: "Paddock",
  openGraph: {
    title: "Paddock — Gigling Racing intelligence",
    description:
      "Evaluate, value, and track every Gigling. Confirmed quality, upside, track fit, and valuation comps from a full-population study of every race.",
    siteName: "Paddock",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

// Set the theme before paint to avoid a flash. Dark is the default; a stored
// preference of "light" switches to the cream paper mode.
const themeScript = `(function(){try{var t=localStorage.getItem('paddock-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The per-request nonce the proxy set; tags the inline theme script so it runs
  // under the nonce-based CSP without script 'unsafe-inline'.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${crimson.variable} ${jetbrains.variable} bg-aurora`}>
        {/* One app-wide wallet context so the top-right wallet pill (in Nav) and the
            per-page boards share a SINGLE connection. Read-only pages render their
            server content through it untouched; the AGW connector only activates on
            an explicit connect. */}
        <WalletProvider>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
