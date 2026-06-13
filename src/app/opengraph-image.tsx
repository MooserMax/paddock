import { ImageResponse } from "next/og";
import { OG_SIZE, OG_COLORS, ogBackground, ogFonts } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Paddock, the open intelligence layer for Gigling Racing";

// The default share card for every page that does not have its own (home,
// scanner, leaderboards, methodology, docs, calibration).
export default async function Image() {
  const fonts = await ogFonts();
  return new ImageResponse(
    (
      <div style={{ ...ogBackground, width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, color: OG_COLORS.ink, fontFamily: "Crimson Pro" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: OG_COLORS.brick, fontSize: 36 }}>✳</span>
          <span style={{ fontSize: 36 }}>Paddock</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 3, marginBottom: 18 }}>
            The open intelligence layer for Gigling Racing
          </span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 76, lineHeight: 1.08 }}>One verified engine.</span>
            <span style={{ fontSize: 76, lineHeight: 1.08, color: OG_COLORS.brick }}>Never a fabricated number.</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 20, color: OG_COLORS.inkSoft }}>
            Evaluate, value, and track every Gigling.
          </span>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 1 }}>
            a Patch Notes product
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined }
  );
}
