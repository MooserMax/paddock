import { ImageResponse } from "next/og";
import { getWalletSummary } from "@/lib/api/queries";
import { lookupUsername } from "@/lib/accounts";
import { shortAddress, ownerDisplay } from "@/lib/format";
import { OG_SIZE, OG_COLORS, ogBackground, ogFonts, ogRarityColor } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Paddock stable report";

export default async function Image({ params }: { params: { address: string } }) {
  const fonts = await ogFonts();
  const address = decodeURIComponent(params.address);
  const [s, username] = await Promise.all([
    getWalletSummary(address).catch(() => null),
    lookupUsername(address).catch(() => null),
  ]);

  // Username headline when known, truncated address otherwise. When a username is
  // shown, the address stays visible (small) in the subtitle so the canonical
  // wallet is never hidden on the share card.
  const headline = ownerDisplay(username, address);
  const stats = s ? `${s.petCount} Giglings · ${s.hatchedCount} hatched` : "stable";
  const subtitle = username ? `${shortAddress(address)} · ${stats}` : stats;

  const value =
    s && s.stableValue.lowEth !== null
      ? `${s.stableValue.lowEth.toFixed(2)} to ${s.stableValue.highEth!.toFixed(2)} ETH`
      : "comps thin";

  return new ImageResponse(
    (
      <div style={{ ...ogBackground, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 64, color: OG_COLORS.ink, fontFamily: "Crimson Pro" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: OG_COLORS.brick, fontSize: 30 }}>✳</span>
            <span style={{ fontSize: 30 }}>Paddock</span>
          </div>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 20, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 2 }}>
            Stable report
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
          <span style={{ fontSize: 84, lineHeight: 1 }}>{headline}</span>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: OG_COLORS.inkSoft, marginTop: 8 }}>
            {subtitle}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 2 }}>
            Estimated stable value
          </span>
          <span style={{ fontSize: 60, color: OG_COLORS.gold, lineHeight: 1.1 }}>{value}</span>
        </div>

        {/* A-team chips */}
        {s && s.aTeam.length > 0 && (
          <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
            {s.aTeam.slice(0, 5).map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, borderWidth: 1, borderStyle: "solid", borderColor: ogRarityColor(p.rarity.value), borderRadius: 999, padding: "6px 16px" }}>
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 20, color: OG_COLORS.ink }}>{p.name ?? `#${p.id}`}</span>
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.gold }}>{p.confirmedQuality.toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "auto" }}>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 20, color: OG_COLORS.inkSoft }}>
            {s && s.flags.length > 0 ? s.flags[0] : "The open intelligence layer for Gigling Racing"}
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
