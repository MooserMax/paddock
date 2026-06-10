import { GLOBAL_TRAIT_LIFT } from "./scoring/constants";

// Rarity display. Relic (5) outranks Legendary (4): the order here is the
// canonical hierarchy used everywhere in the UI.
export const RARITY_ORDER = [6, 5, 4, 3, 2, 0];

export const RARITY_DISPLAY: Record<number, { name: string; color: string }> = {
  6: { name: "Giga", color: "var(--gold)" },
  5: { name: "Relic", color: "var(--glow)" },
  4: { name: "Legendary", color: "var(--cyan)" },
  3: { name: "Epic", color: "var(--green)" },
  2: { name: "Rare", color: "var(--ink-soft)" },
  0: { name: "Unknown", color: "var(--ink-faint)" },
};

export function rarityDisplay(rarity: number | null | undefined) {
  return RARITY_DISPLAY[rarity ?? 0] ?? RARITY_DISPLAY[0];
}

// Trait copy: name, a one-line plain-language effect, and the study-measured
// lift so the UI can show proven impact next to every trait.
export interface TraitMeta {
  name: string;
  blurb: string;
  globalLift: number | null;
}

export const TRAIT_META: Record<string, TraitMeta> = {
  surger: {
    name: "Surger",
    blurb: "Each tick anywhere, a small chance of a big speed surge. The strongest trait in the game.",
    globalLift: GLOBAL_TRAIT_LIFT.surger,
  },
  "fast-start": {
    name: "Fast Start",
    blurb: "A speed boost over the first 50 ticks. Decisive on long tracks.",
    globalLift: null,
  },
  closer: {
    name: "Closer",
    blurb: "Extra speed in the last quarter of the track. Its edge shows only at 2400m and longer.",
    globalLift: null,
  },
  clutch: {
    name: "Clutch",
    blurb: "Late-race surge chance in the final stretch. Helps on sprints, hurts on the longest tracks.",
    globalLift: null,
  },
  steady: {
    name: "Steady",
    blurb: "Compresses per-race stat variance. A consistency trait, not a ceiling trait.",
    globalLift: null,
  },
  comeback: {
    name: "Comeback",
    blurb: "Extra speed while sitting in the back half of the field.",
    globalLift: null,
  },
  "faction-heart": {
    name: "Faction Heart",
    blurb: "An edge on shorter tracks; a drag on the longest ones.",
    globalLift: null,
  },
  volatile: {
    name: "Volatile",
    blurb: "Swingy lottery rolls. Measured to hurt win rate across the population.",
    globalLift: GLOBAL_TRAIT_LIFT.volatile,
  },
};

export function traitMeta(id: string): TraitMeta {
  return TRAIT_META[id] ?? { name: id, blurb: "", globalLift: null };
}

export const TRACK_LABEL: Record<number, string> = {
  500: "500m Sprint",
  1200: "1200m Mile",
  2400: "2400m Route",
  3000: "3000m Marathon",
};

export const STAT_LABEL = {
  start: "Start",
  speed: "Speed",
  stamina: "Stamina",
  finish: "Finish",
} as const;

export function tierStars(tier: number | null): string {
  if (tier === null) return "?";
  return "★".repeat(tier) + "☆".repeat(Math.max(0, 3 - tier));
}
