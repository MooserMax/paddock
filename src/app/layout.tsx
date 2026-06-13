import type { Metadata } from "next";
import { Crimson_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/shell/Nav";
import Footer from "@/components/shell/Footer";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${crimson.variable} ${jetbrains.variable} bg-aurora`}>
        <div className="flex min-h-screen flex-col">
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
