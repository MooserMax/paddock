import { ImageResponse } from "next/og";
import { getPetDossier } from "@/lib/api/queries";
import { OG_SIZE, OG_COLORS, ogBackground, ogFonts, rangeGeometry, ogRarityColor, ogRarityName } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Paddock Gigling dossier";

const STAT_ACCENT = [OG_COLORS.cyan, OG_COLORS.glow, OG_COLORS.green, OG_COLORS.gold];

export default async function Image({ params }: { params: { id: string } }) {
  const fonts = await ogFonts();
  const d = await getPetDossier(Number(params.id)).catch(() => null);

  if (!d) {
    return new ImageResponse(
      (
        <div style={{ ...ogBackground, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: OG_COLORS.ink, fontFamily: "Crimson Pro" }}>
          <div style={{ fontSize: 64 }}>Gigling not found</div>
        </div>
      ),
      { ...size, fonts: fonts.length ? fonts : undefined }
    );
  }

  const rarityColor = ogRarityColor(d.rarity.value);
  const rarityName = ogRarityName(d.rarity.value);
  const stats = [
    { label: "START", ...d.stats.start },
    { label: "SPEED", ...d.stats.speed },
    { label: "STAMINA", ...d.stats.stamina },
    { label: "FINISH", ...d.stats.finish },
  ];

  return new ImageResponse(
    (
      <div style={{ ...ogBackground, width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 64, color: OG_COLORS.ink, fontFamily: "Crimson Pro" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: OG_COLORS.brick, fontSize: 30 }}>✳</span>
            <span style={{ fontSize: 30 }}>Paddock</span>
          </div>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 20, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 2 }}>
            Gigling dossier
          </span>
        </div>

        {/* identity */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginTop: 28 }}>
          <span style={{ fontSize: 96, lineHeight: 1 }}>{d.name ?? `#${d.id}`}</span>
          <span style={{ display: "flex", fontFamily: "JetBrains Mono", fontSize: 24, color: rarityColor, borderWidth: 1, borderStyle: "solid", borderColor: rarityColor, borderRadius: 999, padding: "6px 16px", textTransform: "uppercase", letterSpacing: 2, marginBottom: 14 }}>
            {rarityName}
          </span>
        </div>
        <span style={{ fontFamily: "JetBrains Mono", fontSize: 22, color: OG_COLORS.inkSoft, marginTop: 6 }}>
          {d.faction.name} · {Math.round(d.revealPct * 100)}% revealed
        </span>

        {/* the four stat range bars (signature motif) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 30 }}>
          {stats.map((s, i) => {
            const g = rangeGeometry(s.low, s.high);
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.inkFaint, width: 110, textTransform: "uppercase" }}>{s.label}</span>
                <div style={{ display: "flex", position: "relative", flex: 1, height: 16, background: "rgba(250,245,237,0.06)", borderRadius: 999 }}>
                  <div style={{ display: "flex", position: "absolute", left: `${g.leftPct}%`, width: `${g.widthPct}%`, height: 16, background: STAT_ACCENT[i], opacity: 0.35 + 0.55 * g.revealFrac, borderRadius: 999 }} />
                </div>
                <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.inkSoft, width: 110, textAlign: "right" }}>
                  {g.known ? `${s.low} to ${s.high}` : "unrevealed"}
                </span>
              </div>
            );
          })}
        </div>

        {/* footer scores */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ display: "flex", gap: 44 }}>
            <Stat label="CONFIRMED" value={d.scores.confirmedQuality.toFixed(1)} color={OG_COLORS.gold} />
            <Stat label="UPSIDE" value={d.scores.upside.toFixed(1)} color={OG_COLORS.cyan} />
            <Stat label="BEST" value={`${d.scores.bestDistance}m`} color={OG_COLORS.glow} />
            <Stat label="WIN RATE" value={`${Math.round(d.shark.shrunkWinRate * 100)}%`} color={OG_COLORS.green} />
          </div>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 1 }}>
            a Patch Notes product
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined }
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 16, color: OG_COLORS.inkFaint, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      <span style={{ fontFamily: "JetBrains Mono", fontSize: 40, color }}>{value}</span>
    </div>
  );
}
