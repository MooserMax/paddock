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

export function isFreeEntry(entryFeeWei: string | null | undefined): boolean {
  return BigInt(entryFeeWei ?? "0") === 0n;
}

// THE single flag that gates paid entry. While false, no paid value can be
// constructed (resolveEntryValueWei throws) and the paid UI stays disabled. The
// whole paid path below is built and tested; flipping this one constant to true is
// the ONLY change needed to enable it. Stays false until a human signs one real paid
// entry under the finished flow and verifies it on-chain.
export const PAID_ENTRY_ENABLED = false;

// Validated paid entry value. The wallet charge is entryFee + the PROTOCOL surcharge
// ONLY; the jackpot (2.5%) and creator (1-10%) fees are allocated contract-side from
// the pool and are NOT added to the wallet charge (verified on-chain: non-juiced pets
// paid exactly base+3%, juiced exactly base+1%, never base+all-four). The protocol
// rate depends on the entry's juiced state: protocolFeeBpsJuiced (juiced, ~1%) or
// protocolFeeBps (not juiced, ~3%). Both rates are READ FROM LIVE RACE CONFIG, never
// hardcoded, so a future rate change flows through automatically.
//
// IMPORTANT (verified by historical eth_call at the block before a real join): the
// juiced tier is PRE-COMMITTED per entry, not freely chosen at join. A juiced horse's
// join reverts unless it sends EXACTLY base+1%; a non-juiced horse's reverts unless it
// sends EXACTLY base+3% (overpay AND underpay both revert). So the value must MATCH the
// horse's real state. The mandatory pre-sign simulation at this exact value is what
// enforces that: a tier mismatch reverts in simulation and is never signed.
export function paidEntryValueWei(entryFeeWei: string, protocolFeeBps: number, protocolFeeBpsJuiced: number, juiced: boolean): bigint {
  const fee = BigInt(entryFeeWei);
  const rate = BigInt(juiced ? protocolFeeBpsJuiced : protocolFeeBps);
  return fee + (fee * rate) / 10000n;
}

// The fee tier for a paid entry: the live per-race protocol bps (both rates) plus the
// juiced tier being attempted. Null bps means the race's fee config has not loaded.
export interface EntryFeeTier {
  protocolFeeBps: number | null;
  protocolFeeBpsJuiced: number | null;
  juiced: boolean;
}

// Resolve the exact wei value to send. Free races send 0 (the proven, unchanged
// path). Paid races compute entryFee + protocol surcharge for the chosen tier from
// the LIVE bps. Paid is hard-gated: while PAID_ENTRY_ENABLED is false this throws, so
// no paid value can ever be built in production.
export function resolveEntryValueWei(entryFeeWei: string | null | undefined, tier?: EntryFeeTier): bigint {
  if (isFreeEntry(entryFeeWei)) return 0n;
  if (!PAID_ENTRY_ENABLED) throw new Error("paid-entry-disabled");
  if (!tier || tier.protocolFeeBps == null || tier.protocolFeeBpsJuiced == null) {
    throw new Error("paid-entry-missing-fee-config");
  }
  return paidEntryValueWei(String(entryFeeWei), tier.protocolFeeBps, tier.protocolFeeBpsJuiced, tier.juiced);
}

// Free-path value: 0 for a free race, throws for any paid race. Retained as the
// narrow free-only resolver; it delegates so the gate lives in one place.
export function entryValueWei(entryFeeWei: string | null | undefined): bigint {
  return resolveEntryValueWei(entryFeeWei);
}

export interface JoinTx {
  to: Hex;
  data: Hex;
  value: bigint;
}

// Build the join tx. The calldata is byte-identical for every entry regardless of
// fee or juiced tier (verified on-chain: the juiced choice changes ONLY the value,
// never the calldata). A free entry passes no tier and sends 0; a paid entry passes
// the live tier and sends entryFee + the matching surcharge.
export function buildJoinTx(raceId: number, petId: number, entryFeeWei: string | null | undefined, tier?: EntryFeeTier): JoinTx {
  return { to: PETRACING_CONTRACT as Hex, data: buildJoinRaceData(raceId, petId), value: resolveEntryValueWei(entryFeeWei, tier) };
}

// Verify a constructed tx matches the known-good on-chain join exactly. Called right
// before signing; a mismatch must abort, never a blind signature. expectedValue is
// computed independently by the caller (0 for free, the surcharge total for paid) and
// asserted here, so the signed value can never silently drift from what was shown.
export function assertKnownGoodJoinTx(tx: JoinTx, raceId: number, petId: number, expectedValue: bigint = 0n): void {
  if (tx.to.toLowerCase() !== PETRACING_CONTRACT.toLowerCase()) throw new Error("contract address mismatch");
  if (tx.data.slice(0, 10).toLowerCase() !== JOIN_RACE_SELECTOR) throw new Error("selector mismatch");
  if (tx.data.toLowerCase() !== buildJoinRaceData(raceId, petId).toLowerCase()) throw new Error("calldata mismatch");
  if (tx.data.length !== STANDARD_JOIN_CALLDATA_LEN) throw new Error("unexpected calldata length");
  if (tx.value !== expectedValue) throw new Error("entry value mismatch");
}
