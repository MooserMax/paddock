// Shared helpers for og:image cards. Fonts are fetched once and cached; if the
// fetch fails the card still renders in a fallback face rather than erroring.

export const OG_SIZE = { width: 1200, height: 630 };

export const OG_COLORS = {
  paper: "#14110f",
  ink: "#faf5ed",
  inkSoft: "#c9bfb2",
  inkFaint: "#8a8073",
  brick: "#9c2a2a",
  glow: "#e8694f",
  gold: "#e6bc5c",
  cyan: "#6fb7c4",
  green: "#9fbe6a",
  line: "rgba(250,245,237,0.12)",
};

let fontCache: { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" }[] | null = null;

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`;
  const css = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }).then((r) => r.text());
  const match = css.match(/src:\s*url\(([^)]+)\)/);
  if (!match) throw new Error("font src not found");
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

export async function ogFonts() {
  if (fontCache) return fontCache;
  try {
    const [serif, mono] = await Promise.all([
      loadGoogleFont("Crimson Pro", 600),
      loadGoogleFont("JetBrains Mono", 500),
    ]);
    fontCache = [
      { name: "Crimson Pro", data: serif, weight: 600, style: "normal" },
      { name: "JetBrains Mono", data: mono, weight: 500, style: "normal" },
    ];
  } catch {
    fontCache = [];
  }
  return fontCache;
}

// Rarity colors as hex (satori cannot parse the web UI's CSS variables).
export function ogRarityColor(rarity: number): string {
  return (
    { 6: OG_COLORS.gold, 5: OG_COLORS.glow, 4: OG_COLORS.cyan, 3: OG_COLORS.green, 2: OG_COLORS.inkSoft }[rarity] ??
    OG_COLORS.inkFaint
  );
}

export function ogRarityName(rarity: number): string {
  return { 6: "Giga", 5: "Relic", 4: "Legendary", 3: "Epic", 2: "Rare" }[rarity] ?? "Unknown";
}

// The dark aurora background for og cards. satori needs backgroundColor and
// backgroundImage separate, and supports linear-gradient layers.
export const ogBackground: React.CSSProperties = {
  backgroundColor: OG_COLORS.paper,
  backgroundImage:
    "linear-gradient(135deg, rgba(232,105,79,0.14), rgba(232,105,79,0) 42%), linear-gradient(315deg, rgba(111,183,196,0.12), rgba(111,183,196,0) 42%)",
};

// A reveal range bar for the card (the signature motif): a band positioned on a
// 50-100 track. Returned as plain style objects the card composes.
export function rangeGeometry(low: number | null, high: number | null) {
  const known = low !== null && high !== null;
  const lo = known ? Math.max(50, Math.min(100, low)) : 50;
  const hi = known ? Math.max(50, Math.min(100, high)) : 100;
  const leftPct = ((lo - 50) / 50) * 100;
  const widthPct = Math.max(2, ((hi - lo) / 50) * 100);
  const revealFrac = known ? Math.min(1, Math.max(0, (50 - (hi - lo)) / 50)) : 0;
  return { leftPct, widthPct, revealFrac, known };
}
