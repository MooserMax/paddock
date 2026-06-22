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

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  return Math.round(value).toLocaleString("en-US");
}

// The single rule for a stable's competitive standing, shared by the leaderboard,
// the report bar, and the share card. Lead with percentile only near the top
// (top quartile); below that lead with rank, so the worst stable reads "Rank 197
// of 197", never the broken/insulting "Top 100%". The percentile uses floor with
// a clamp at 1, so the very best reads "Top 1%", never "Top 0%". The 25% cutoff is
// a deliberate display choice, not a statistical threshold.
// The number of top ranks shown as an EXPLICIT rank (with denominator) rather
// than a percentile. A rounded percentile collapses distinct top ranks together
// (rank 1 and rank 2 both floor to "Top 1%"), so the top of the board must carry
// its literal rank; only below this does "Top X%" become the more legible hero.
export const RANK_EXPLICIT_TOP = 10;

export function stableStanding(percentile: number | null | undefined, rank: number | null | undefined, total: number | null | undefined): string {
  if (percentile == null || rank == null || total == null || !Number.isFinite(percentile)) return "unranked";
  if (rank <= RANK_EXPLICIT_TOP) return `Rank ${rank} of ${total}`;
  return `Top ${Math.max(1, Math.floor(percentile * 100))}%`;
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
