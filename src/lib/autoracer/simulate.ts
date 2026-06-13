import { chainClient } from "../chain";
import { assertSafe, TxIntent, SafetyResult } from "./guard";

// Read-only dry run. The guard's static checks are the hard guarantee; this adds
// an eth_call so we also confirm the transaction would not revert for a given
// sender. NOTHING is signed or broadcast: eth_call executes against current state
// and discards the result. A real signer would additionally inspect the state
// diff, but the contract has been proven (SECURITY.md) to only read ownerOf, and
// the guard guarantees the call is joinRace-to-racing-contract-with-0-value.

export interface DryRunResult {
  intent: { to: string; data: string; value: string };
  safety: SafetyResult;
  simulated: { attempted: boolean; reverted: boolean; error: string | null };
}

export async function dryRunJoinRace(tx: TxIntent, from?: string): Promise<DryRunResult> {
  const safety = assertSafe(tx);
  const result: DryRunResult = {
    intent: { to: tx.to, data: tx.data, value: tx.value.toString() },
    safety,
    simulated: { attempted: false, reverted: false, error: null },
  };

  // Only simulate something the guard already certified safe. Never call out
  // for a transaction we would refuse to sign.
  if (!safety.safe) return result;

  result.simulated.attempted = true;
  try {
    await chainClient().call({
      to: tx.to as `0x${string}`,
      data: tx.data,
      value: tx.value,
      ...(from ? { account: from as `0x${string}` } : {}),
    });
  } catch (err) {
    // A revert here usually means the race is closed, full, or the sender does
    // not own the pet. That is a state issue, not a safety failure.
    result.simulated.reverted = true;
    result.simulated.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : "reverted";
  }
  return result;
}
