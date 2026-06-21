import { ImageResponse } from "next/og";
import { getWalletSummary } from "@/lib/api/queries";
import { ownerDisplay, formatPercentile } from "@/lib/format";
import { OG_SIZE, OG_COLORS, ogBackground, ogFonts } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Paddock stable grade";
// Cached: the card changes only when the underlying stable data refreshes, so it
// is not regenerated per request.
export const revalidate = 300;

const SHARE_URL = "paddock-scott-s-projects5.vercel.app";

// Fetch the horse art and inline it as a data URL, so a failed image never leaves
// a broken-image icon on a shareable asset (the card simply omits the art).
async function imageDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

// The shareable stable card, double duty as the link-unfurl image. Minimal by
// design: one hero figure (the percentile grade, the brag), the username, two
// small supporting stats, and the stable's top-by-cq horse as the character,
// over hard Paddock branding. Honest states: ranked (percentile hero), limited
// (holdings hero, no rank claim), none (holdings hero, reveal prompt).
export default async function Image({ params }: { params: { address: string } }) {
  const fonts = await ogFonts();
  const address = decodeURIComponent(params.address);
  const s = await getWalletSummary(address).catch(() => null);

  const name = s ? ownerDisplay(s.name, s.address) : address.slice(0, 6) + "..." + address.slice(-4);
  const skill = s?.skill;
  const ranked = skill?.state === "ranked";
  const limited = skill?.state === "limited";

  // The character: the stable's highest-cq proven horse (what the grade rates
  // first), falling back to the top hatched horse for ungraded stables.
  const topHorse = (skill?.topPetId != null ? s?.aTeam.find((p) => p.id === skill.topPetId) : null) ?? s?.aTeam[0] ?? null;
  const horseArt = await imageDataUrl(topHorse?.imgUrl);

  // Hero figure: the percentile when ranked, else honest holdings.
  const heroValue = ranked ? formatPercentile(skill!.percentile).toUpperCase() : `${s?.petCount ?? 0}`;
  const heroLabel = ranked
    ? `of ${skill!.eligibleTotal} stables by proven roster quality`
    : limited
      ? `Giglings held. ${skill!.provenCount} proven, reveal 3 or more for your stable grade`
      : "Giglings held. Reveal horses to earn your stable grade";

  const valueText =
    s && s.stableValue.lowEth !== null
      ? `est. ${s.stableValue.lowEth.toFixed(2)} to ${s.stableValue.highEth!.toFixed(2)} ETH`
      : "est. value, comps thin";

  return new ImageResponse(
    (
      <div style={{ ...ogBackground, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 64, color: OG_COLORS.ink, fontFamily: "Crimson Pro" }}>
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: OG_COLORS.glow, fontSize: 34 }}>✳</span>
            <span style={{ fontSize: 34 }}>Paddock</span>
          </div>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 20, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 2 }}>
            Stable grade
          </span>
        </div>

        {/* Body: data left, character right */}
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 680 }}>
            <span style={{ fontFamily: "JetBrains Mono", fontSize: 30, color: OG_COLORS.inkSoft }}>{name}</span>
            <span style={{ fontSize: ranked ? 150 : 120, lineHeight: 1, color: OG_COLORS.glow, marginTop: 6 }}>{heroValue}</span>
            <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: OG_COLORS.inkFaint, marginTop: 10, maxWidth: 620 }}>{heroLabel}</span>
            <div style={{ display: "flex", gap: 28, marginTop: 28 }}>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: 24, color: OG_COLORS.inkSoft }}>{s?.petCount ?? 0} Giglings</span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: 24, color: OG_COLORS.gold }}>{valueText}</span>
            </div>
          </div>

          {/* Character: the top horse */}
          {horseArt ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <img src={horseArt} width={260} height={260} style={{ borderRadius: 18, border: `2px solid ${OG_COLORS.line}` }} alt="" />
              {topHorse && ranked && (
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: OG_COLORS.inkSoft, marginTop: 12 }}>
                  #{topHorse.id} · {topHorse.confirmedQuality.toFixed(1)}
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", width: 260, height: 260, alignItems: "center", justifyContent: "center", borderRadius: 18, border: `2px solid ${OG_COLORS.line}` }}>
              <span style={{ color: OG_COLORS.glow, fontSize: 90 }}>✳</span>
            </div>
          )}
        </div>

        {/* URL + brand */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: OG_COLORS.ink }}>{SHARE_URL}</span>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 1 }}>
            a Patch Notes product
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined }
  );
}
