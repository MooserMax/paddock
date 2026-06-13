// SIGNER-REJECTION TEST (required reviewer for the auto-racer).
// Proves the safety guard ACCEPTS only a zero-value joinRace to the racing
// contract and REFUSES every dangerous transaction. Pure logic, no network,
// no key. Run: npm run test:signer
import { encodeFunctionData, toFunctionSelector } from "viem";
import { assertSafe } from "../src/lib/autoracer/guard";
import { buildJoinRaceTx } from "../src/lib/autoracer/build";
import { RACING_CONTRACT, GIGAPET_NFT } from "../src/lib/chain";

const enc = (abi: string, name: string, args: unknown[]) =>
  encodeFunctionData({ abi: [{ type: "function", name, stateMutability: "nonpayable", inputs: parseInputs(abi), outputs: [] }] as never, functionName: name as never, args: args as never });

function parseInputs(sig: string) {
  const inner = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
  if (!inner) return [];
  return inner.split(",").map((t, i) => ({ name: `a${i}`, type: t.trim() }));
}

const OPERATOR = "0x963F00d3ff000064fFCbA824b800c0000000C300";
const SOMEONE = "0x0000000000000000000000000000000000001234";

interface Case { name: string; tx: { to: string; data: `0x${string}`; value: bigint }; expectSafe: boolean }

const cases: Case[] = [
  // The one allowed transaction.
  { name: "free-race joinRace to racing contract, value 0", tx: buildJoinRaceTx(5667, 6249), expectSafe: true },

  // The most dangerous ERC-721/1155 calls, all must be refused.
  { name: "setApprovalForAll(operator,true) on Giglings", tx: { to: GIGAPET_NFT, data: enc("setApprovalForAll(address,bool)", "setApprovalForAll", [OPERATOR, true]), value: 0n }, expectSafe: false },
  { name: "approve(operator, tokenId) on Giglings", tx: { to: GIGAPET_NFT, data: enc("approve(address,uint256)", "approve", [OPERATOR, 6249n]), value: 0n }, expectSafe: false },
  { name: "transferFrom(me, someone, tokenId)", tx: { to: GIGAPET_NFT, data: enc("transferFrom(address,address,uint256)", "transferFrom", [SOMEONE, OPERATOR, 6249n]), value: 0n }, expectSafe: false },
  { name: "safeTransferFrom(me, someone, tokenId)", tx: { to: GIGAPET_NFT, data: enc("safeTransferFrom(address,address,uint256)", "safeTransferFrom", [SOMEONE, OPERATOR, 6249n]), value: 0n }, expectSafe: false },

  // joinRace, but tampered: each tamper must be refused.
  { name: "joinRace but to the WRONG contract (Giglings)", tx: { to: GIGAPET_NFT, data: buildJoinRaceTx(5667, 6249).data, value: 0n }, expectSafe: false },
  { name: "joinRace but with NONZERO value", tx: { ...buildJoinRaceTx(5667, 6249), value: 1000000000000000n }, expectSafe: false },
  { name: "joinRace but with non-empty hookData", tx: { to: RACING_CONTRACT, data: encodeFunctionData({ abi: [{ type: "function", name: "joinRace", stateMutability: "payable", inputs: [{ name: "r", type: "uint256" }, { name: "p", type: "uint256" }, { name: "h", type: "bytes" }], outputs: [] }], functionName: "joinRace", args: [5667n, 6249n, "0xdeadbeef"] }), value: 0n }, expectSafe: false },

  // An unknown function to the racing contract.
  { name: "unknown selector to racing contract", tx: { to: RACING_CONTRACT, data: (toFunctionSelector("rugPull()") + "") as `0x${string}`, value: 0n }, expectSafe: false },
];

console.log("SIGNER-REJECTION TEST\n");
let allPass = true;
for (const c of cases) {
  const res = assertSafe(c.tx);
  const correct = res.safe === c.expectSafe;
  if (!correct) allPass = false;
  const verdict = res.safe ? "ACCEPT" : "REJECT";
  const want = c.expectSafe ? "ACCEPT" : "REJECT";
  console.log(`  ${correct ? "PASS" : "FAIL"}  [${verdict} / want ${want}]  ${c.name}`);
  if (!res.safe && c.expectSafe) console.log(`        reason: ${res.reason}`);
}
console.log(`\n${allPass ? "PASS" : "FAIL"}: the guard accepts only the free-race joinRace and refuses all else.`);
process.exit(allPass ? 0 : 1);
