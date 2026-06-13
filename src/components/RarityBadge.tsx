import { rarityDisplay } from "@/lib/display";

// Rarity chip in the canonical hierarchy (Giga > Relic > Legendary > Epic > Rare).
export default function RarityBadge({
  rarity,
  size = "md",
}: {
  rarity: number | null | undefined;
  size?: "sm" | "md";
}) {
  const { name, color } = rarityDisplay(rarity);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1"}`}
      style={{ borderColor: color }}
    >
      <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: color }} aria-hidden />
      <span className="type-micro uppercase tracking-wider" style={{ color }}>
        {name}
      </span>
    </span>
  );
}
