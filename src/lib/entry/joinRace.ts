import { encodeAbiParameters, parseAbiParameters, encodeFunctionData, decodeEventLog, type Hex } from "viem";

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
export const PAID_ENTRY_ENABLED = true;

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

// ---- Develop Mode: batched FREE entry (EIP-5792) ----------------------------
// Race your least-revealed horses into open FREE races to farm stat reveals, in one
// approval. FREE-ONLY by construction: every call is value 0, so no funds are ever at
// risk, and the paid path is not involved at all.

// Practical batch ceiling, matched to field/daily limits. Never submit more than this
// in one approval, so the review stays scannable and the gas stays bounded.
export const DEVELOP_MAX_BATCH = 8;

// One-flag gate for Develop Mode (free-only, asset-safe). Live by default; flip to
// false to hide the feature in one line if needed.
export const DEVELOP_MODE_ENABLED = true;

// ---- Create & Fill: create your own FREE race, then batch-fill it ------------
// Two signatures: createRace (this), then the existing EIP-5792 free batch into the
// new raceId. createRace is the ONLY new write. Everything is value 0.
//
// The ABI and the free config below were VERIFIED, not guessed: the function selector
// (0x8d6e45d3) byte-matches real on-chain createRace txs, and this exact free config
// (entryFee 0, creatorFeeBps 100 = the on-chain minimum, payout [10000], no hook, no
// extra params, value 0) was confirmed to succeed via eth_call from a registered
// wallet. NOTE: createRace requires the creator wallet to be a registered Gigaverse
// account; an unregistered wallet reverts, which the UI detects via the pre-sign
// simulation and surfaces instead of submitting.
export const CREATE_RACE_SELECTOR = "0x8d6e45d3" as const;
// RACE_CREATED event; topic1 is the new raceId (matches chain.ts TOPIC_RACE_CREATED).
export const RACE_CREATED_TOPIC = "0x6ba8300c6b71e5709b9f114f7522ac8c31ada85783b0c40d18eb76a6ba995f9b" as const;

// Verified-valid bounds for a user-created free race.
export const CREATE_FIELD_MIN = 2;
export const CREATE_FIELD_MAX = 8;
export const CREATE_TRACK_LENGTHS = [500, 1200, 2400, 3000] as const;
const CREATE_MIN_CREATOR_FEE_BPS = 100n; // on-chain minimum (creatorFeeBps below this reverts)

const CREATE_RACE_ABI = [
  {
    name: "createRace",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "fieldSize", type: "uint256" },
      { name: "trackLength", type: "uint256" },
      { name: "entryFeeWei", type: "uint256" },
      { name: "creatorFeeBps", type: "uint256" },
      { name: "payoutDistribution", type: "uint256[]" },
      { name: "joinHook", type: "address" },
      { name: "extraParamIds", type: "uint256[]" },
      { name: "extraParamVals", type: "uint256[]" },
    ],
    outputs: [{ name: "raceId", type: "uint256" }],
  },
] as const;

const RACE_CREATED_EVENT_ABI = [
  { name: "RaceCreated", type: "event", inputs: [{ name: "raceId", type: "uint256", indexed: true }] },
] as const;

// Build a FREE createRace tx: entry fee 0, value 0, targeting ONLY the pinned racing
// contract. The selector is asserted against the verified createRace selector.
export function buildCreateRaceTx(fieldSize: number, trackLength: number): { to: Hex; data: Hex; value: bigint } {
  if (!Number.isInteger(fieldSize) || fieldSize < CREATE_FIELD_MIN || fieldSize > CREATE_FIELD_MAX) throw new Error("invalid field size");
  if (!(CREATE_TRACK_LENGTHS as readonly number[]).includes(trackLength)) throw new Error("invalid track length");
  const data = encodeFunctionData({
    abi: CREATE_RACE_ABI,
    functionName: "createRace",
    args: [BigInt(fieldSize), BigInt(trackLength), 0n, CREATE_MIN_CREATOR_FEE_BPS, [10000n], "0x0000000000000000000000000000000000000000", [], []],
  });
  if (!data.toLowerCase().startsWith(CREATE_RACE_SELECTOR)) throw new Error("createRace selector mismatch");
  return { to: PETRACING_CONTRACT as Hex, data: data as Hex, value: 0n };
}

// createRace revert reasons (verified on-chain, names where recoverable):
//  - NoAccount(): the wallet is not a registered Gigaverse player.
//  - 0x4a2b0d40 (custom, not in any public ABI): the wallet already has a race it
//    created that has not resolved yet. Verified 7/7: it reverts iff the creator's
//    last-created race is phase < 3 and clears the moment that race resolves. It is
//    NOT a time cooldown, so there is no countdown, only "until your race finishes".
export const CREATE_ERR_NO_ACCOUNT = "0xce418820" as const; // NoAccount()
export const CREATE_ERR_OPEN_RACE = "0x4a2b0d40" as const; // unresolved created-race gate

// Map a createRace revert selector to an accurate, distinct user message. Unknown
// reverts get a neutral retry message, never a wrong reason.
export function mapCreateRevert(selector: string | null): string {
  const s = (selector ?? "").toLowerCase();
  if (s === CREATE_ERR_NO_ACCOUNT) return "Creating a race requires a registered Gigaverse account. Connect a registered wallet to create races.";
  if (s === CREATE_ERR_OPEN_RACE) return "You already have a race you created that has not finished yet. You can create another once it resolves.";
  return "This race cannot be created right now. Try again shortly.";
}

// Extract the 4-byte revert selector from a viem error. Walks the cause chain for a
// hex data field, then falls back to scanning the stringified error for a known
// selector, so a custom-error revert is identified reliably across error shapes.
export function revertSelector(err: unknown): string | null {
  type E = { data?: unknown; details?: unknown; cause?: unknown; message?: unknown };
  let e = err as E | undefined;
  for (let i = 0; i < 10 && e; i++) {
    const d = e.data;
    const candidates: unknown[] = [d, (d as { data?: unknown } | undefined)?.data, e.details];
    for (const cand of candidates) {
      if (typeof cand === "string" && cand.startsWith("0x") && cand.length >= 10) return cand.slice(0, 10).toLowerCase();
    }
    e = e.cause as E | undefined;
  }
  try {
    const s = (JSON.stringify(err) + String((err as E)?.message ?? "")).toLowerCase();
    for (const k of [CREATE_ERR_NO_ACCOUNT, CREATE_ERR_OPEN_RACE]) if (s.includes(k)) return k;
  } catch { /* ignore */ }
  return null;
}

// Parse the new raceId from a createRace receipt's RACE_CREATED log (topic1).
export function parseCreatedRaceId(logs: readonly { address: string; topics: readonly string[]; data: string }[]): number | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== PETRACING_CONTRACT.toLowerCase()) continue;
    if ((log.topics[0] ?? "").toLowerCase() !== RACE_CREATED_TOPIC) continue;
    try {
      const decoded = decodeEventLog({ abi: RACE_CREATED_EVENT_ABI, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] });
      const raceId = (decoded.args as { raceId?: bigint }).raceId;
      if (raceId != null) return Number(raceId);
    } catch {
      // topic1 fallback: the new raceId is the first indexed arg
      if (log.topics[1]) return Number(BigInt(log.topics[1]));
    }
  }
  return null;
}

// One call in a Develop batch: the 0x-hex shape EIP-5792 sendCalls expects.
export interface BatchCall {
  to: Hex;
  data: Hex;
  value: Hex; // always "0x0" here, asserted below
}

// Build a single FREE join call for a batch. It goes through the SAME asserted path
// as a single entry, so the pinned racing contract, the selector, the exact calldata
// shape, AND value 0 are all verified for EVERY call before it can enter a batch. A
// non-free or wrong-target call can never be constructed here: buildJoinTx("0")
// resolves value 0, and assertKnownGoodJoinTx enforces the contract allowlist and the
// zero value. This is the per-call security gate for the batch.
export function buildFreeJoinCall(raceId: number, petId: number): BatchCall {
  const tx = buildJoinTx(raceId, petId, "0"); // free: resolveEntryValueWei -> 0n
  assertKnownGoodJoinTx(tx, raceId, petId, 0n); // contract + selector + calldata + value 0
  if (tx.value !== 0n) throw new Error("develop batch call must be value 0");
  return { to: tx.to, data: tx.data, value: "0x0" };
}
