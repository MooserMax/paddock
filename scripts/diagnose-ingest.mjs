// Diagnose why race ingestion is stuck behind chain head (read-only).
import { createPublicClient, http } from "viem";
import { createClient } from "@supabase/supabase-js";

const RPC = process.env.RPC_URL || "https://api.mainnet.abs.xyz";
const RACING = "0x16e0b3d6394ce7597d34b73f5e5fb165fd74394e";
const CREATED = "0x6ba8300c6b71e5709b9f114f7522ac8c31ada85783b0c40d18eb76a6ba995f9b";
const RESOLVED = "0xfd6f2ec0d5b0c729a44291652465b5fbd261acb855f8980662e847fb5a7f7469";

const client = createPublicClient({ transport: http(RPC) });
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const head = await client.getBlockNumber();
console.log("chain head:", head.toString());

const { data: scanState } = await db.from("sync_state").select("value, updated_at").eq("key", "races_scan").maybeSingle();
const lastBlock = scanState ? BigInt(scanState.value.lastBlock) : 0n;
console.log("scan checkpoint lastBlock:", lastBlock.toString(), "| updated:", scanState?.updated_at);
console.log("blocks behind head:", (head - lastBlock).toString());

const { count: created } = await db.from("races").select("*", { count: "exact", head: true });
const { count: resolved } = await db.from("races").select("*", { count: "exact", head: true }).eq("resolved", true);
const { data: maxRow } = await db.from("races").select("race_id").order("race_id", { ascending: false }).limit(1).maybeSingle();
console.log("\nDB: racesCreated:", created, "| resolved:", resolved, "| max race_id:", maxRow?.race_id);

// Probe: does the RPC return RaceCreated logs near head? Walk back from head in 100k windows.
console.log("\n--- probing on-chain for newest RaceCreated (log-indexing lag check) ---");
let newestCreatedBlock = null, newestRaceId = null, scanned = 0n;
for (let back = 0n; back < 2_000_000n && newestCreatedBlock === null; back += 100_000n) {
  const to = head - back;
  const from = to - 99_999n;
  const logs = await client.request({
    method: "eth_getLogs",
    params: [{ address: RACING, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [[CREATED]] }],
  });
  scanned += 100_000n;
  if (logs.length > 0) {
    const last = logs[logs.length - 1];
    newestCreatedBlock = BigInt(last.blockNumber);
    newestRaceId = BigInt(last.topics[1]).toString();
    console.log(`newest RaceCreated on-chain: race ${newestRaceId} at block ${newestCreatedBlock} (${(head - newestCreatedBlock)} blocks behind head)`);
    console.log(`  RaceCreated events in that 100k window: ${logs.length}`);
  }
}
if (newestCreatedBlock === null) console.log(`NO RaceCreated events found in the last ${scanned} blocks (heavy log lag or no recent races)`);

// Are there RaceCreated events BETWEEN our checkpoint and head that we should have?
console.log("\n--- RaceCreated events between checkpoint and head (what we may have skipped) ---");
if (lastBlock > 0n && lastBlock < head) {
  let total = 0, ids = [];
  for (let from = lastBlock + 1n; from <= head; from += 100_000n) {
    const to = from + 99_999n > head ? head : from + 99_999n;
    const logs = await client.request({ method: "eth_getLogs", params: [{ address: RACING, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [[CREATED]] }] });
    total += logs.length;
    for (const l of logs) ids.push(Number(BigInt(l.topics[1])));
  }
  console.log(`RaceCreated events ahead of checkpoint: ${total}`);
  if (ids.length) console.log(`  raceId range ahead: ${Math.min(...ids)} .. ${Math.max(...ids)}`);
} else {
  console.log("checkpoint is at or past head; nothing ahead to scan (this is the bug if races exist past our max)");
}
