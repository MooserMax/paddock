import { db } from "../db";
import { fetchAccount, sleep, REQUEST_GAP_MS } from "../gigaverse";

export interface AccountSyncResult {
  candidates: number; // displayed owner addresses considered this run
  looked: number; // external account lookups performed
  named: number; // of those, how many returned a username
  remaining: number; // due addresses spilled to the next cycle
}

// The bounded set of addresses the site actually displays: owners of leaderboard-
// ranked horses (CQ / ELO / most-winning) plus owners active in recent races. We
// resolve usernames only for these, not the whole 28k-pet population.
async function displayedOwnerAddresses(): Promise<string[]> {
  const set = new Set<string>();
  const add = (a: unknown) => {
    if (typeof a === "string" && a) set.add(a.toLowerCase());
  };

  // Owners of the top confirmed-quality horses (CQ board).
  const { data: cq } = await db()
    .from("pet_scores")
    .select("pet_id")
    .order("confirmed_quality", { ascending: false, nullsFirst: false })
    .limit(60);
  const cqIds = (cq ?? []).map((r) => r.pet_id as number);
  if (cqIds.length) {
    const { data } = await db().from("pets").select("owner_address").in("id", cqIds);
    for (const r of data ?? []) add(r.owner_address);
  }

  // Owners of the top-ELO and most-winning horses (ELO + win-rate boards).
  const { data: elo } = await db()
    .from("pets")
    .select("owner_address")
    .gt("races_run", 0)
    .order("elo", { ascending: false, nullsFirst: false })
    .limit(60);
  for (const r of elo ?? []) add(r.owner_address);

  const { data: wins } = await db()
    .from("pets")
    .select("owner_address")
    .gte("races_run", 5)
    .order("wins", { ascending: false })
    .limit(60);
  for (const r of wins ?? []) add(r.owner_address);

  // New owners seen this cycle: recent race entrants (also covers active earners).
  const { data: recent } = await db()
    .from("race_entries")
    .select("owner_address")
    .order("race_id", { ascending: false })
    .limit(300);
  for (const r of recent ?? []) add(r.owner_address);

  return [...set];
}

// Resolve Gigaverse usernames for displayed owners. Refreshes only addresses we
// have never checked or last checked more than refreshDays ago (so renames are
// caught without re-fetching resolved addresses every cycle), capped at
// maxLookups per call (with an optional wall-clock deadline) so the rest spills
// to the next cycle and the ingest stays within its time budget.
export async function syncAccounts(opts: {
  maxLookups: number;
  refreshDays: number;
  deadline?: number;
}): Promise<AccountSyncResult> {
  const { maxLookups, refreshDays, deadline } = opts;
  const candidates = await displayedOwnerAddresses();
  if (candidates.length === 0) return { candidates: 0, looked: 0, named: 0, remaining: 0 };

  // Which candidates are due: unknown, or last checked older than the window.
  const cutoff = new Date(Date.now() - refreshDays * 86_400_000).toISOString();
  const checkedAt = new Map<string, string | null>();
  for (let i = 0; i < candidates.length; i += 300) {
    const chunk = candidates.slice(i, i + 300);
    const { data, error } = await db().from("accounts").select("address, last_checked_at").in("address", chunk);
    if (error) throw new Error(`accounts staleness query failed: ${error.message}`);
    for (const r of data ?? []) checkedAt.set(r.address as string, r.last_checked_at as string | null);
  }
  const due = candidates.filter((a) => {
    const c = checkedAt.get(a);
    return c === undefined || c === null || c < cutoff;
  });

  const batch = due.slice(0, maxLookups);
  let looked = 0;
  let named = 0;
  for (const address of batch) {
    if (deadline && Date.now() > deadline) break;
    let username: string | null = null;
    try {
      const acct = await fetchAccount(address);
      username = acct.primaryUsername?.trim() || null;
    } catch {
      username = null; // unreachable handle: still record the check below
    }
    await sleep(REQUEST_GAP_MS);
    // Record the check even when there is no username, so a handle-less wallet is
    // not re-fetched every cycle; it refreshes again only after refreshDays.
    const { error } = await db()
      .from("accounts")
      .upsert({ address, username, last_checked_at: new Date().toISOString() }, { onConflict: "address" });
    if (error) throw new Error(`accounts upsert failed: ${error.message}`);
    looked += 1;
    if (username) named += 1;
  }

  return { candidates: candidates.length, looked, named, remaining: Math.max(0, due.length - looked) };
}
