// Display formatting. No em-dashes anywhere in UI copy: use "to" for ranges
// and a hyphen or "unknown" for absent values.

export function shortAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// The single rule for what to show for a wallet anywhere on the site: the
// Gigaverse username when we have resolved one, else the truncated address.
// Never fabricated. Used by <OwnerLabel> (HTML surfaces) and resolveOwnerName
// (string surfaces: OG image, <title> metadata) so the rule lives in one place.
export function ownerDisplay(username: string | null | undefined, address: string): string {
  const u = username?.trim();
  return u && u.length > 0 ? u : shortAddress(address);
}

// Honest freshness label for a paddock-db "as of" timestamp. Shows local HH:MM, and
// a relative "(Nm ago)" when the data is meaningfully old, so a lagging view reads as
// dated rather than silently live. Client-only (uses Date.now); safe in components.
export function asOfLabel(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "unknown";
  const hhmm = new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins >= 2) return `${hhmm} (${mins}m ago)`;
  return hhmm;
}

export function formatEth(value: number | null | undefined, places = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  return `${value.toFixed(places)} ETH`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  if (value >= 1000) return `$${Math.round(value).toLocaleString("en-US")}`;
  return `$${value.toFixed(2)}`;
}

export function formatPct(fraction: number | null | undefined, places = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "unknown";
  return `${(fraction * 100).toFixed(places)}%`;
}

// Win probability is an honest band, never a false-precise percent. The live odds
// model adds ELO and stat-fit signals that Paddock cannot validate out of sample
// (they are current-only and would leak past outcomes), so absolute probabilities
// are uncalibrated, and the held-out win-rate curve is itself overconfident in the
// tail: a predicted 0.95 hits ~0.77 in reality. So we cap the display: the strongest
// favorite reads "Heavy favorite", never "99.97%". Ordering still uses the raw
// number; only the rendered magnitude is banded. PWIN_CEILING is the empirical
// actual-win-frequency ceiling from the calibration buckets.
export const PWIN_CEILING = 0.8;

export function pWinBand(p: number | null | undefined): { label: string; range: string } {
  if (p === null || p === undefined || !Number.isFinite(p)) return { label: "unknown", range: "not enough to estimate" };
  if (p >= 0.62) return { label: "Heavy favorite", range: "best in this field" };
  if (p >= 0.45) return { label: "Favored", range: "roughly 45 to 65%" };
  if (p >= 0.25) return { label: "Live contender", range: "roughly 25 to 45%" };
  if (p >= 0.1) return { label: "In the mix", range: "roughly 10 to 25%" };
  return { label: "Long shot", range: "under 10%" };
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  return Math.round(value).toLocaleString("en-US");
}

// The single rule for a stable's competitive standing, shared by the leaderboard,
// the report bar, and the share card. One format top to bottom: the explicit
// "Rank N of {total}", so every stable is directly comparable and the precise
// standing always shows. The percentile is rounded and less precise, and mixing
// it in forced viewers to convert between an ordinal and a percentage; the
// progress bar already conveys the proportional "where you sit". A low rank shows
// a high number on purpose (e.g. "Rank 180 of 195"), unsoftened. The rank-1
// special treatment ("#1 STABLE" / "The top stable in the game") lives in the
// surfaces. The percentile param is kept for call-site compatibility and the API.
export function stableStanding(_percentile: number | null | undefined, rank: number | null | undefined, total: number | null | undefined): string {
  if (rank == null || total == null || !Number.isFinite(rank) || !Number.isFinite(total)) return "unranked";
  return `Rank ${rank} of ${total}`;
}

// A single horse's confirmed-quality standing in the whole game, e.g. "top 0.03%".
// fraction is the EXACT share of horses with cq >= this horse's, so two horses of
// different cq never collapse to the same figure: precision adapts to how small
// the percentage is. No assumed maximum.
export function formatHorsePercentile(fraction: number | null | undefined): string | null {
  if (fraction == null || !Number.isFinite(fraction)) return null;
  const x = fraction * 100;
  let s: string;
  if (x >= 10) s = String(Math.round(x));
  else if (x >= 1) s = x.toFixed(1);
  else if (x >= 0.1) s = x.toFixed(2);
  else s = x.toFixed(3); // very small: keep enough digits to stay distinct
  if (parseFloat(s) === 0) s = "0.001"; // never show top 0%
  return `top ${s}%`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  return value.toFixed(1);
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// "3 days ago", "2 hours ago". Compact, no em-dashes.
// A finish time in ms as seconds to 2 decimals, e.g. 19037 -> "19.04s".
export function formatRaceTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  return `${(ms / 1000).toFixed(2)}s`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
