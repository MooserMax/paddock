import { encodeAbiParameters, parseAbiParameters, type Hex } from "viem";

// One-click entry: construct the exact joinRace transaction the user signs in their
// own wallet. Non-custodial: this builds calldata only, it never holds keys, never
// signs, never custodies. Everything here is pinned and verified against real
// on-chain joins decoded in Phase 0.

// PINNED. The only address the entry path ever targets. Never sourced from input,
// URL, API, or an injected provider; a hardcoded constant by design.
export const PETRACING_CONTRACT = "0xF6Ed2a53F311352c869e268601AAe5B78B9a9650" as const;

// joinRace(uint256 raceId, uint256 petId, <empty dynamic>). Selector and the empty
// third parameter were confirmed across 1932 real on-chain joins (zero non-empty).
export const JOIN_RACE_SELECTOR = "0x168491e9" as const;

export const ABSTRACT_CHAIN_ID = 2741;

// A standard entry is exactly the selector plus three encoded words plus the empty
// array length: selector (8 hex) + 4 words (256 hex) + "0x" = 266 characters.
const STANDARD_JOIN_CALLDATA_LEN = 266;

// Build the calldata as raw selector + abi-encoded params, NOT via a named-ABI
// writeContract, so it matches the verified on-chain shape byte for byte with no
// guess of the function name. Encoding an empty uint256[] yields offset 0x60 and
// length 0, exactly the standard empty third parameter.
export function buildJoinRaceData(raceId: number | bigint, petId: number | bigint): Hex {
  const params = encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256[]"), [
    BigInt(raceId),
    BigInt(petId),
    [],
  ]);
  return (JOIN_RACE_SELECTOR + params.slice(2)) as Hex;
}

// Free races only in this build. Paid entry is gated behind a security review and
// multi-tier surcharge confirmation (Phase 0 confirmed the surcharge on one tier
// only), so a non-zero fee throws rather than guessing the paid value.
export function isFreeEntry(entryFeeWei: string | null | undefined): boolean {
  return BigInt(entryFeeWei ?? "0") === 0n;
}

export function entryValueWei(entryFeeWei: string | null | undefined): bigint {
  if (!isFreeEntry(entryFeeWei)) throw new Error("paid-entry-disabled");
  return 0n;
}

// Paid entry is BUILT but HARD-DISABLED. This flag and the throw in entryValueWei
// keep the enabled path free-only until a human review approves flipping it.
export const PAID_ENTRY_ENABLED = false;

// Validated paid entry value. Derived from real paid joins and proven by simulation
// across multiple fee tiers and both juiced states (no spend): the value is the
// entry fee plus the PROTOCOL fee, and the protocol rate depends on juiced state,
// protocolFeeBps when not juiced, protocolFeeBpsJuiced when juiced. The contract
// requires the EXACT value (overpaying also reverts), so the juiced flag must be
// right. Paddock entries are never juiced (the third param is always empty), so the
// non-juiced rate applies. Evidence: race 13374 non-juiced fee 5e14 -> 5.15e14 (3%
// = protocolFeeBps 300); race 13133 juiced fee 5e14 -> 5.05e14 (1% =
// protocolFeeBpsJuiced 100); race 13319 juiced fee 2.5e15 -> 2.525e15. This is NOT
// wired into the live path; it exists so the paid machinery is ready and tested.
export function paidEntryValueWei(entryFeeWei: string, protocolFeeBps: number, protocolFeeBpsJuiced: number, juiced: boolean): bigint {
  const fee = BigInt(entryFeeWei);
  const rate = BigInt(juiced ? protocolFeeBpsJuiced : protocolFeeBps);
  return fee + (fee * rate) / 10000n;
}

export interface JoinTx {
  to: Hex;
  data: Hex;
  value: bigint;
}

export function buildJoinTx(raceId: number, petId: number, entryFeeWei: string | null | undefined): JoinTx {
  return { to: PETRACING_CONTRACT as Hex, data: buildJoinRaceData(raceId, petId), value: entryValueWei(entryFeeWei) };
}

// Verify a constructed tx matches the known-good on-chain join exactly. Called
// right before signing; a mismatch must abort, never a blind signature.
export function assertKnownGoodJoinTx(tx: JoinTx, raceId: number, petId: number): void {
  if (tx.to.toLowerCase() !== PETRACING_CONTRACT.toLowerCase()) throw new Error("contract address mismatch");
  if (tx.data.slice(0, 10).toLowerCase() !== JOIN_RACE_SELECTOR) throw new Error("selector mismatch");
  if (tx.data.toLowerCase() !== buildJoinRaceData(raceId, petId).toLowerCase()) throw new Error("calldata mismatch");
  if (tx.data.length !== STANDARD_JOIN_CALLDATA_LEN) throw new Error("unexpected calldata length");
  if (tx.value !== 0n) throw new Error("non-free entry not enabled");
}
