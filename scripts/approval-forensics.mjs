// =============================================================================
// Paddock approval forensics: Giglings setApprovalForAll audit for a wallet.
//
// STRICTLY READ-ONLY AND KEYLESS.
//   - This script ONLY reads ApprovalForAll event logs and computes their net
//     state. It NEVER signs, sends, broadcasts, or submits any transaction, and
//     it NEVER loads, requires, or touches a private key. There is no signer and
//     no write path anywhere in this file.
//
// WHAT IT REGENERATES (the evidence behind SECURITY.md, on demand):
//   - Given a wallet, lists the operators currently approved (net state) on the
//     Giglings collection, and asserts the PetRacingSystem racing contract is NOT
//     among them. The racing contract never needs operator approval because
//     joinRace only reads ownerOf (proven by contract-forensics.mjs).
// Prints a single PASS (racing contract not approved) or FAIL (it is, investigate).
//
// CONFIG:
//   ABSTRACT_RPC_URL    Abstract RPC endpoint   (default: public mainnet RPC)
//   APPROVAL_START_BLOCK  first block to scan    (default: 67000000)
//   Wallet: first CLI arg, else FORENSICS_WALLET env, else the SECURITY.md wallet.
//
//   Run: node scripts/approval-forensics.mjs [walletAddress]
// =============================================================================
import { createPublicClient, http, getAddress, toEventSelector } from "viem";

const RPC = process.env.ABSTRACT_RPC_URL || process.env.RPC_URL || "https://api.mainnet.abs.xyz";
const GIGLINGS = "0xd320831c876190c7ef79376ffcc889756f038e04";
const RACING = "0x16e0B3D6394CE7597D34b73f5E5Fb165fD74394E";
const APPROVAL_FOR_ALL = toEventSelector("ApprovalForAll(address,address,bool)");
const START_BLOCK = BigInt(process.env.APPROVAL_START_BLOCK || "67000000");

const walletArg = process.argv[2] || process.env.FORENSICS_WALLET || "0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30";
let WALLET;
try {
  WALLET = getAddress(walletArg);
} catch {
  console.error(`Invalid wallet address: ${walletArg}`);
  process.exit(2);
}

const client = createPublicClient({ transport: http(RPC, { retryCount: 3, retryDelay: 800 }) });

// Adaptive eth_getLogs: halve the range whenever the RPC rejects it.
async function getLogsChunked(params, from, to) {
  if (from > to) return [];
  try {
    return await client.getLogs({ ...params, fromBlock: from, toBlock: to });
  } catch (err) {
    if (to - from < 5000n) throw err;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([
      getLogsChunked(params, from, mid),
      getLogsChunked(params, mid + 1n, to),
    ]);
    return [...a, ...b];
  }
}

console.log("Paddock approval forensics (read-only, keyless)");
console.log(`RPC: ${RPC}`);
console.log(`wallet:   ${WALLET}`);
console.log(`Giglings: ${GIGLINGS}`);
console.log(`racing:   ${RACING}\n`);

const head = await client.getBlockNumber();
const ownerTopic = "0x" + "0".repeat(24) + WALLET.slice(2).toLowerCase();

let approvals = [];
const WINDOW = 100000n;
for (let from = START_BLOCK; from <= head; from += WINDOW) {
  const to = from + WINDOW - 1n > head ? head : from + WINDOW - 1n;
  const logs = await getLogsChunked(
    { address: GIGLINGS, topics: [APPROVAL_FOR_ALL, ownerTopic] },
    from,
    to
  );
  approvals.push(...logs);
}

// Net current state: last event per operator wins. Empty data is treated as false.
approvals.sort((x, y) =>
  x.blockNumber === y.blockNumber ? Number(x.logIndex - y.logIndex) : Number(x.blockNumber - y.blockNumber)
);
const net = new Map();
for (const a of approvals) {
  const operator = getAddress("0x" + a.topics[2].slice(26));
  const approved = a.data && a.data !== "0x" ? BigInt(a.data) === 1n : false;
  net.set(operator, { approved, block: a.blockNumber, tx: a.transactionHash });
}
const live = [...net.entries()].filter(([, v]) => v.approved);

console.log(`ApprovalForAll events (raw): ${approvals.length}`);
console.log(`unique operators ever approved: ${net.size}`);
console.log(`operators CURRENTLY approved (net true): ${live.length}`);
for (const [op, v] of live) {
  const isRacing = op.toLowerCase() === RACING.toLowerCase();
  console.log(`  ${op}${isRacing ? "  <-- RACING CONTRACT" : ""}  (since block ${v.block}, tx ${v.tx})`);
}

const racingApproved = net.get(getAddress(RACING))?.approved === true;
const ok = !racingApproved;
console.log(
  `\n${ok ? "PASS" : "FAIL"}: racing contract ${RACING} is ${racingApproved ? "CURRENTLY APPROVED as an operator (investigate immediately)" : "NOT an approved operator"} on the Giglings collection for this wallet.`
);
process.exit(ok ? 0 : 1);
