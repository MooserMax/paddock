# Paddock Security: Auto-Racer Contract Safety

## Summary
Paddock's XP auto-racer signs exactly one kind of transaction: a FREE-race entry
(joinRace) on the Gigaverse PetRacingSystem. Entering a race never moves your
Giglings and never moves ETH on a free race. This document is the on-chain proof,
not an assurance. It must be re-verified if the racing contract is upgraded or its
address changes.

## Scope
- Racing contract (PetRacingSystem): 0x16e0B3D6394CE7597D34b73f5E5Fb165fD74394E (Abstract, chain 2741)
- Giglings NFT (GigaPetNFT), separate contract: 0xd320831c876190c7ef79376ffcc889756f038e04
- Verification: Exact Match source on abscan.

---

## 1. Contract address

- **Full checksummed address:** `0x16e0B3D6394CE7597D34b73f5E5Fb165fD74394E`
- **Contract name (from verified source):** `PetRacingSystem`
- **Explorer:** https://abscan.org/address/0x16e0B3D6394CE7597D34b73f5E5Fb165fD74394E
- Chain: Abstract (2741). Note: this is the racing *system* contract. The Giglings NFT itself is a separate contract, `GigaPetNFT` at `0xd320831c876190c7ef79376ffcc889756f038e04`.

## 2. Verification status

**Yes, verified.** abscan shows an **Exact Match** on the source. The keyless V1 ABI endpoint is deprecated (needs an Etherscan V2 key), but the verified Solidity is served on the page. Race-related functions exposed include `createRace`, `joinRace`, plus a set of document-id getters (`raceDocId`, `raceEntryDocId`, `raceFeeSnapshotDocId`, `raceFundingDocId`, `raceLimitConfigDocId`). It resolves dependent systems (the pet NFT, traits, juice) dynamically through a `_gameRegistry`.

## 3. The dagrid Quick Race "free race" entry function

Decoded from real transactions:

- **Function:** `joinRace(uint256 raceId, uint256 petId, bytes hookData)`
- **Selector:** `0x168491e9` (custom; not in the 4byte registry). The same function handles both create and join; joining a not-yet-existing `raceId` opens it.
- **Decoded args** from tx `0x07cdede0bd41a9bae9b743f439894cc72cc143a4b3052f33fa3fa6ae113efb84` (race 6375): `raceId=6375`, `petId=26657`, `hookData=0x` (empty).
- **msg.value = 0 ETH** (free race confirmed).
- **Giglings-collection token logs in the tx: 0** (no Transfer, no approval).

## 4. What `joinRace` actually does (from the verified source)

```solidity
function joinRace(uint256 raceId, uint256 petId, bytes calldata hookData)
    external payable whenNotPaused nonReentrant {
    ...
    IGigaPetNFT petNft = IGigaPetNFT(_gameRegistry.getSystem(GIGA_PET_NFT_ID));
    if (petNft.ownerOf(petId) != entrant) revert NotPetOwner();   // READ-ONLY ownership check
    ...
    if (msg.value != entryFee + protoSurcharge) revert WrongEntryFee();
    _setDocBoolValue(petStatusDoc, PET_LOCKED_CID, true);          // soft-lock in game state
    _appendPetToRace(raceDocId, petId);
    ...
}
```

**The security-relevant answer:**
- It calls **`ownerOf(petId)`, a read,** to confirm you own the pet. That is the only NFT interaction.
- It does **NOT** call `transferFrom`, `safeTransferFrom`, `isApprovedForAll`, or `setApprovalForAll` on the Giglings collection. (Those tokens do appear in the flattened file, but only inside the bundled OpenZeppelin standard library, not in `joinRace`'s path.)
- **Your gigling never leaves your wallet.** During a race the pet is "locked" by an internal document flag (`PET_LOCKED_CID = true`), which is the game's own state, not an NFT escrow or transfer.
- **msg.value:** the contract requires `msg.value == entryFee + protoSurcharge` exactly. For free races both are 0, so it reverts on anything but 0 ETH. The protocol fee is a surcharge added on top of the entry fee, not skimmed from the prize pool.

This matches the on-chain evidence exactly: a real entry moved zero tokens and required zero approval.

## 5. Your wallet's approvals on the Giglings collection

For `0xA8A956a5690cc81bB367DA2C2f6f1796Be2B3C30`:

- **1,287** `setApprovalForAll` events historically, across **348 distinct operators**, the classic approve/revoke churn of per-listing marketplace activity.
- **Currently approved (net state): exactly 1 operator**, `0x963F00d3ff000064fFCbA824b800c0000000C300` (a contract, 3,190 bytes, no token interface; the vanity address is the signature of a marketplace settlement operator, not racing).
- **The racing contract `0x16e0B3D6...394E` is NOT, and was not, an approved operator.** It never needs to be: `joinRace` only reads `ownerOf`.

**Bottom line:** entering a Gigling in a Quick Race is a read-ownership plus lock-in-game-state operation. It costs 0 ETH on free races, never transfers your NFT, and requires no `setApprovalForAll` to the racing contract. The only standing approval on your wallet is a marketplace operator, unrelated to racing.

---

## Enforced invariants (tested in code, not just documented)
The signer MUST reject, and never construct, any of the following:
- ERC721 approve or setApprovalForAll on the Giglings collection
- ERC20 approve / permit
- any transaction with nonzero msg.value
- any joinRace whose simulated state diff shows a token Transfer or an approval

## Process invariants
- Every transaction is simulated before signing; the decoded function, token ids,
  and msg.value (must be 0) are shown to the user, with the simulated state diff.
- Paid races (buy-in > 0) are excluded from the auto loop and require a separate,
  single, manual confirmation showing exact ETH + USD.
- Per-transaction wallet approval only. No batch pre-authorization, no session keys.

## How to re-verify (one command each)
The evidence above is regenerated on demand by two read-only, keyless scripts. They
ONLY read (decode txs, read verified source, query approvals); they never sign, send,
or load a private key. Each prints a single PASS or FAIL.

```
# 1. Decode a representative recent DIRECT free-race joinRace entry (re-discovered each run),
#    confirm 0 ETH and zero token movement, and re-read the verified joinRace source
#    to assert ownerOf is the only NFT interaction.
node scripts/contract-forensics.mjs

# 2. List the wallet's current net setApprovalForAll operators on the Giglings
#    collection and confirm the racing contract is NOT among them.
node scripts/approval-forensics.mjs [walletAddress]
```

Both run with zero configuration against the public Abstract RPC. Optional environment
variables (never hardcoded, never committed; see .env.example):
- `ABSTRACT_RPC_URL` your own Abstract RPC endpoint (default: public mainnet RPC)
- `ABSCAN_API_KEY` Etherscan V2 key to fetch verified source via API instead of the
  keyless explorer page
- `FORENSICS_WALLET` / first CLI arg: the wallet to audit in script 2
- `APPROVAL_START_BLOCK` first block to scan for approvals (default: 67000000)

A nonzero exit code means a check failed: something changed, re-verify before trusting
the auto-racer.

## Re-verification triggers
Re-run the full analysis (decode a representative recent free-race entry tx + re-read joinRace source)
if any of these change: the PetRacingSystem address, its verified source hash, or the
GigaPetNFT address. Stale safety analysis is not safety.
