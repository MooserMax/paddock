import { encodeFunctionData } from "viem";
import { RACING_CONTRACT } from "../chain";
import { JOIN_RACE_ABI, TxIntent } from "./guard";

// Build the ONE transaction the auto-racer is allowed to construct: a free-race
// joinRace with empty hookData and zero value, targeting the racing contract.
// There is no other builder. The calldata is typed from the ABI, never raw hex.
export function buildJoinRaceTx(raceId: number, petId: number): TxIntent {
  const data = encodeFunctionData({
    abi: JOIN_RACE_ABI,
    functionName: "joinRace",
    args: [BigInt(raceId), BigInt(petId), "0x"],
  });
  return { to: RACING_CONTRACT, data, value: 0n };
}
