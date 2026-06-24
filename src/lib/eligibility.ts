import { chainClient } from "./chain";
import { buildJoinRaceData, PETRACING_CONTRACT } from "./entry/joinRace";

// Daily race eligibility, authoritative from the contract. Gigaverse enforces a per
// pet daily race limit ON-CHAIN: joinRace REVERTS for an exhausted pet (and for a
// pet busy in another active race). This is the same eth_call the entry guard uses,
// so a recommended pet is always one the user could actually enter. No off-chain
// endpoint, no guessed reset boundary: the contract decides.
//
// Read-only. Cached per pet (the daily/busy state is race-independent, so one probe
// answers for all lobbies) with a short TTL, so repeated lobby polls do not
// re-simulate. Bounded and parallel, on the free Abstract RPC.

const cache = new Map<number, { eligible: boolean; at: number }>();
const TTL_MS = 60_000;

async function simulate(owner: string, probeRaceId: number, petId: number): Promise<boolean> {
  try {
    await chainClient().request({
      method: "eth_call",
      params: [
        { from: owner as `0x${string}`, to: PETRACING_CONTRACT, data: buildJoinRaceData(probeRaceId, petId), value: "0x0" },
        "latest",
      ],
    });
    return true; // no revert: the pet can race now
  } catch {
    return false; // revert: daily limit reached, busy, or otherwise ineligible
  }
}

// Returns the subset of petIds that can race now. probeRaceId is any current open
// forming race; eligibility is per pet, so the choice of probe does not matter.
export async function eligiblePets(owner: string, probeRaceId: number, petIds: number[]): Promise<Set<number>> {
  const now = Date.now();
  const result = new Set<number>();
  const toCheck: number[] = [];
  for (const id of petIds) {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) {
      if (hit.eligible) result.add(id);
    } else {
      toCheck.push(id);
    }
  }
  await Promise.all(
    toCheck.map(async (id) => {
      const ok = await simulate(owner, probeRaceId, id);
      cache.set(id, { eligible: ok, at: Date.now() });
      if (ok) result.add(id);
    })
  );
  return result;
}
