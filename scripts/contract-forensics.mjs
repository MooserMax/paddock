// =============================================================================
// Paddock contract forensics: PetRacingSystem joinRace safety proof.
//
// STRICTLY READ-ONLY AND KEYLESS.
//   - This script ONLY reads: it fetches transactions, reads verified source,
//     and decodes calldata. It NEVER signs, sends, broadcasts, or submits any
//     transaction, and it NEVER loads, requires, or touches a private key.
//   - There is no signer, no wallet client, no write path anywhere in this file.
//     A proof harness that could move assets would defeat its own purpose.
//
// WHAT IT REGENERATES (the evidence behind SECURITY.md, on demand):
//   1. Fetches a FRESH free-race joinRace entry tx (re-discovered each run, not a
//      hardcoded hash) and prints the function name, decoded args, and msg.value.
//   2. Asserts the on-chain tx moved zero Giglings tokens (no Transfer/approval log).
//   3. Re-reads the verified joinRace source and asserts ownerOf is the only NFT
//      interaction, with no transferFrom / safeTransferFrom / isApprovedForAll /
//      setApprovalForAll in its body.
// Prints a single PASS (still green) or FAIL (something changed, re-verify).
//
// CONFIG (all optional, from environment, never hardcoded secrets):
//   ABSTRACT_RPC_URL   Abstract RPC endpoint   (default: public mainnet RPC)
//   ABSCAN_API_KEY     Etherscan V2 key for source fetch via API. If unset, the
//                      script falls back to the keyless public explorer page.
//
//   Run: node scripts/contract-forensics.mjs
// =============================================================================
import { createPublicClient, http, decodeFunctionData, toFunctionSelector, formatEther } from "viem";

const RPC = process.env.ABSTRACT_RPC_URL || process.env.RPC_URL || "https://api.mainnet.abs.xyz";
const ABSCAN_KEY = process.env.ABSCAN_API_KEY || "";

// Subjects of verification. If any of these change, re-verification is required
// (see SECURITY.md "Re-verification triggers").
const RACING = "0x16e0B3D6394CE7597D34b73f5E5Fb165fD74394E";
const GIGLINGS = "0xd320831c876190c7ef79376ffcc889756f038e04";
const CHAIN_ID = 2741;

const JOIN_RACE_ABI = [
  {
    type: "function",
    name: "joinRace",
    stateMutability: "payable",
    inputs: [
      { name: "raceId", type: "uint256" },
      { name: "petId", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
];
const JOIN_RACE_SELECTOR = toFunctionSelector("joinRace(uint256,uint256,bytes)");
const RACE_CREATED_TOPIC = "0x6ba8300c6b71e5709b9f114f7522ac8c31ada85783b0c40d18eb76a6ba995f9b";
const FORBIDDEN = ["transferFrom", "safeTransferFrom", "isApprovedForAll", "setApprovalForAll"];

const client = createPublicClient({ transport: http(RPC, { retryCount: 3, retryDelay: 800 }) });
const checks = [];
const record = (ok, label, detail = "") => {
  checks.push(ok);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? "  ::  " + detail : ""}`);
};

// --- Step 1+2: discover a fresh free-race joinRace tx and inspect it ----------
async function findFreeJoinRace() {
  const head = await client.getBlockNumber();
  // Scan backward from head in windows until we find the most recent tx that is a
  // joinRace with msg.value == 0 (a free-race entry). Racing logs can be sparse and
  // the newest may sit well behind head, so the scan reaches back generously rather
  // than assuming recent activity. The tx is re-discovered every run, never hardcoded.
  const WINDOW = 100000n;
  const MAX_LOOKBACK = 2000000n;
  for (let back = 0n; back < MAX_LOOKBACK; back += WINDOW) {
    const to = head - back;
    const from = to - WINDOW + 1n > 0n ? to - WINDOW + 1n : 0n;
    const logs = await client.getLogs({ address: RACING, fromBlock: from, toBlock: to });
    const txHashes = [...new Set(logs.map((l) => l.transactionHash))].reverse();
    for (const hash of txHashes) {
      const tx = await client.getTransaction({ hash });
      if (tx.to?.toLowerCase() !== RACING.toLowerCase()) continue;
      if (tx.input.slice(0, 10) !== JOIN_RACE_SELECTOR) continue;
      if (tx.value !== 0n) continue;
      return tx;
    }
  }
  return null;
}

console.log("Paddock contract forensics (read-only, keyless)");
console.log(`RPC: ${RPC}`);
console.log(`PetRacingSystem: ${RACING}`);
console.log(`Giglings (GigaPetNFT): ${GIGLINGS}\n`);

console.log("1. Fresh free-race joinRace entry");
const tx = await findFreeJoinRace();
if (!tx) {
  record(false, "found a recent free-race joinRace tx", "none discovered in lookback window");
} else {
  const decoded = decodeFunctionData({ abi: JOIN_RACE_ABI, data: tx.input });
  console.log(`     tx: ${tx.hash}`);
  console.log(`     function: joinRace(uint256 raceId, uint256 petId, bytes hookData)  selector ${JOIN_RACE_SELECTOR}`);
  console.log(`     args: raceId=${decoded.args[0]}  petId=${decoded.args[1]}  hookData=${decoded.args[2] === "0x" ? "0x (empty)" : decoded.args[2]}`);
  console.log(`     msg.value: ${formatEther(tx.value)} ETH (${tx.value} wei)`);
  record(tx.input.slice(0, 10) === JOIN_RACE_SELECTOR, "entry selector matches joinRace(uint256,uint256,bytes)");
  record(tx.value === 0n, "free-race entry sends 0 ETH");

  const receipt = await client.getTransactionReceipt({ hash: tx.hash });
  const giglingLogs = receipt.logs.filter((l) => l.address.toLowerCase() === GIGLINGS.toLowerCase());
  record(giglingLogs.length === 0, "zero Giglings token logs in the entry tx (no Transfer or approval)",
    `${giglingLogs.length} log(s)`);
}

// --- Step 3: re-read verified joinRace source and assert its NFT calls --------
async function fetchVerifiedSource() {
  if (ABSCAN_KEY) {
    const url = `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract&action=getsourcecode&address=${RACING}&apikey=${ABSCAN_KEY}`;
    const j = await (await fetch(url)).json();
    const raw = j?.result?.[0]?.SourceCode;
    if (raw && raw !== "Contract source code not verified") {
      // Multi-file sources are wrapped in {{ ... }}.
      if (raw.startsWith("{{")) {
        const parsed = JSON.parse(raw.slice(1, -1));
        return Object.values(parsed.sources).map((s) => s.content).join("\n");
      }
      return raw;
    }
  }
  // Keyless fallback: the verified source is embedded in the public explorer page.
  const html = await (await fetch(`https://abscan.org/address/${RACING}`, {
    headers: { "user-agent": "Mozilla/5.0 (paddock-forensics; read-only)" },
  })).text();
  return html
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "    ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Extract the joinRace IMPLEMENTATION body (the occurrence whose body contains
// real logic, not an interface stub).
function extractJoinRaceBody(source) {
  const parts = source.split(/function\s+joinRace/);
  for (let i = 1; i < parts.length; i++) {
    const body = ("function joinRace" + parts[i]).split(/\n\s*function\s/)[0];
    if (body.includes("ownerOf(")) return body;
  }
  return null;
}

console.log("\n3. Verified joinRace source");
console.log(`     source: ${ABSCAN_KEY ? "Etherscan V2 API (ABSCAN_API_KEY set)" : "keyless public explorer page"}`);
try {
  const source = await fetchVerifiedSource();
  const body = extractJoinRaceBody(source);
  if (!body) {
    record(false, "located joinRace implementation in verified source", "body not found; source structure changed");
  } else {
    const hasOwnerOf = /ownerOf\s*\(/.test(body);
    const forbiddenHits = FORBIDDEN.filter((f) => new RegExp(`\\b${f}\\s*\\(`).test(body));
    record(hasOwnerOf, "joinRace calls ownerOf (read-only ownership check)");
    record(forbiddenHits.length === 0, "joinRace body contains no transferFrom/safeTransferFrom/isApprovedForAll/setApprovalForAll",
      forbiddenHits.length ? "found: " + forbiddenHits.join(", ") : "none present");
    // Show the ownership-check line as visible evidence.
    const line = body.split("\n").find((l) => l.includes("ownerOf("));
    if (line) console.log(`     evidence: ${line.trim()}`);
  }
} catch (err) {
  record(false, "fetched and parsed verified source", String(err.message).slice(0, 80));
}

// --- Verdict -----------------------------------------------------------------
const allPass = checks.length > 0 && checks.every(Boolean);
console.log(`\n${allPass ? "PASS" : "FAIL"}: ${allPass
  ? "free-race entry is read-only ownership + 0 ETH; matches SECURITY.md."
  : "something changed. Re-verify before trusting the auto-racer (see SECURITY.md)."}`);
process.exit(allPass ? 0 : 1);
