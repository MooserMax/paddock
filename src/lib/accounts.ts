import { db } from "./db";
import { ownerDisplay } from "./format";

// Read-only username resolution from the accounts table (populated by ingest).
// Every wallet-display surface reads through here; nothing makes a per-render
// external call. If the accounts table is missing or a row is absent, these
// degrade to null / the truncated address, so the site never breaks and never
// invents a name.

// Raw username for one address, or null. For DTOs that carry ownerName.
export async function lookupUsername(address: string | null | undefined): Promise<string | null> {
  if (!address) return null;
  const { data, error } = await db()
    .from("accounts")
    .select("username")
    .eq("address", address.toLowerCase())
    .maybeSingle();
  if (error) return null; // table absent or transient: fall back to address
  const u = (data?.username as string | null)?.trim();
  return u && u.length > 0 ? u : null;
}

// One address -> display string (username || truncated address). For the string
// surfaces that cannot use the <OwnerLabel> component: OG image, <title> meta.
export async function resolveOwnerName(address: string | null | undefined): Promise<string> {
  if (!address) return "unknown";
  return ownerDisplay(await lookupUsername(address), address);
}

// Batch: many addresses -> map of lowercased address -> raw username (present
// ones only). Callers apply ownerDisplay()/<OwnerLabel> for the fallback. Used by
// the leaderboard so a 50-row board is one query, not 50.
export async function lookupUsernames(addresses: (string | null | undefined)[]): Promise<Map<string, string>> {
  const lowers = [...new Set(addresses.filter((a): a is string => !!a).map((a) => a.toLowerCase()))];
  const out = new Map<string, string>();
  for (let i = 0; i < lowers.length; i += 300) {
    const { data, error } = await db()
      .from("accounts")
      .select("address, username")
      .in("address", lowers.slice(i, i + 300));
    if (error) return out; // table absent: callers fall back to truncated addresses
    for (const r of data ?? []) {
      const u = (r.username as string | null)?.trim();
      if (u && u.length > 0) out.set(r.address as string, u);
    }
  }
  return out;
}
