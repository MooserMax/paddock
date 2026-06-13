import { toFunctionSelector, decodeFunctionData } from "viem";
import { RACING_CONTRACT, GIGAPET_NFT } from "../chain";

// The auto-racer safety guard. Every transaction the auto-racer would ever sign
// must pass assertSafe first. The guarantees are STATIC and absolute: the only
// constructible transaction is joinRace, to the racing contract, with value 0.
// This is the code-level enforcement of SECURITY.md; the signer-rejection test
// proves it refuses everything else.
//
// This module is part of the SIGNING path and is fully isolated from /api/v1.
// The two worlds never mix.

export const JOIN_RACE_SELECTOR = toFunctionSelector("joinRace(uint256,uint256,bytes)"); // 0x168491e9

export const JOIN_RACE_ABI = [
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
] as const;

// The single most dangerous functions in ERC-721/1155. Named explicitly so the
// guard refuses them by name, not only by the allowlist (defense in depth).
export const FORBIDDEN_SELECTORS: Record<string, string> = {
  [toFunctionSelector("approve(address,uint256)")]: "ERC721 approve",
  [toFunctionSelector("setApprovalForAll(address,bool)")]: "setApprovalForAll",
  [toFunctionSelector("transferFrom(address,address,uint256)")]: "transferFrom",
  [toFunctionSelector("safeTransferFrom(address,address,uint256)")]: "safeTransferFrom",
  [toFunctionSelector("safeTransferFrom(address,address,uint256,bytes)")]: "safeTransferFrom(data)",
  [toFunctionSelector("safeTransferFrom(address,address,uint256,uint256,bytes)")]: "ERC1155 safeTransferFrom",
  [toFunctionSelector("setApprovalForAll(address,bool)")]: "setApprovalForAll",
  [toFunctionSelector("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)")]: "ERC20 permit",
};

export interface TxIntent {
  to: string;
  data: `0x${string}`;
  value: bigint;
}

export interface SafetyCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface SafetyResult {
  safe: boolean;
  reason: string | null;
  checks: SafetyCheck[];
}

export function assertSafe(tx: TxIntent): SafetyResult {
  const checks: SafetyCheck[] = [];
  const selector = (tx.data ?? "0x").slice(0, 10).toLowerCase();

  // 1. Contract allowlist: the racing contract is the ONLY permitted target.
  const toOk = typeof tx.to === "string" && tx.to.toLowerCase() === RACING_CONTRACT.toLowerCase();
  checks.push({ name: "Contract allowlist", pass: toOk, detail: toOk ? `to == racing contract` : `to ${tx.to} is not the racing contract` });

  // 2. Zero value: the auto-racer signs free races only. Never moves ETH.
  const valueOk = tx.value === 0n;
  checks.push({ name: "Zero value", pass: valueOk, detail: valueOk ? "msg.value == 0" : `msg.value == ${tx.value} (must be 0)` });

  // 3. Not a forbidden function (approve / setApprovalForAll / transfer / permit).
  const forbiddenHit = FORBIDDEN_SELECTORS[selector];
  checks.push({ name: "No approval or transfer", pass: !forbiddenHit, detail: forbiddenHit ? `refuses ${forbiddenHit}` : "no approval/transfer selector" });

  // 4. Function allowlist: the calldata must be joinRace and nothing else.
  const selectorOk = selector === JOIN_RACE_SELECTOR.toLowerCase();
  checks.push({ name: "Function allowlist", pass: selectorOk, detail: selectorOk ? "selector == joinRace" : `selector ${selector} is not joinRace` });

  // 5. Decodes cleanly as joinRace with EMPTY hookData (no smuggled payload).
  let decodeOk = false;
  let decodeDetail = "calldata is not joinRace";
  if (selectorOk) {
    try {
      const decoded = decodeFunctionData({ abi: JOIN_RACE_ABI, data: tx.data });
      const hookData = decoded.args[2] as string;
      decodeOk = hookData === "0x";
      decodeDetail = decodeOk ? `joinRace(raceId=${decoded.args[0]}, petId=${decoded.args[1]}, hookData=0x)` : "hookData is not empty";
    } catch {
      decodeDetail = "calldata failed to decode as joinRace";
    }
  }
  checks.push({ name: "Decodes as joinRace, empty hookData", pass: decodeOk, detail: decodeDetail });

  const failed = checks.find((c) => !c.pass);
  return { safe: !failed, reason: failed ? failed.detail : null, checks };
}

// The contract addresses the guard reasons about, exposed for the UI/tests.
export const GUARD_CONTRACTS = { racing: RACING_CONTRACT, giglings: GIGAPET_NFT };
