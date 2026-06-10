# Paddock

The intelligence layer for Gigaverse Gigling Racing. Paddock evaluates, values,
and tracks every Gigling in the game: confirmed quality from revealed data,
upside for unrevealed horses, track fit, reveal milestones, and sale-comp
valuations. A Patch Notes product.

**The honest-data principle:** every number shown is either a true revealed
value, an explicit range with reveal progress, or clearly labeled as an
estimate with methodology. Paddock never presents the midpoint of an
unrevealed range as a stat.

## Architecture

Next.js 14 (App Router) + Supabase (Postgres) + Vercel. Scheduled crons ingest
into our own database; the public site reads only from our database. Page
loads never call Gigaverse, OpenSea, or an RPC directly.

```
Abstract RPC (race events)  --\
Gigaverse API (pets, races) ---+--> Vercel crons --> Supabase --> site
OpenSea API (sales)         ---/        (polite, checkpointed, idempotent)
Coinbase API (ETH/USD)      --/
```

### Data sources
- Abstract chain `https://api.mainnet.abs.xyz`, racing contract
  `0x16e0b3d6394ce7597d34b73f5e5fb165fd74394e`. The authoritative, gap-free
  record of every race. (`0xd320...8e04` is GigaPetNFT, the Gigling ERC-721.)
- `gigaverse.io/api/racing/pets?ids=...` and `/api/racing/race/{id}` for pet
  and race details, consumed politely: batches of 25 or less, 500ms or more
  between calls, exponential backoff, checkpointing.
- OpenSea events for `gigaverse-giglings` sales (valuation comps).
- Coinbase spot for ETH/USD.

### On-chain events (verified against live logs)
- `RaceCreated` topic0 `0x6ba8300c...` with topic1 = raceId (indexed). Full
  parameter list unknown and unneeded; details come from the race API.
- `RaceResolved(uint256,uint256[],uint256[],uint256[],uint256[])` topic0
  `0xfd6f2ec0...` with topic1 = raceId. Data arrays: pet ids in finish order,
  finish times in ms, and two arrays observed empty. Decode verified against
  the race API for races 1 and 4000.

## Setup

1. Create a dedicated Supabase project and run `supabase/schema.sql` in the
   SQL editor.
2. `cp .env.example .env.local` and fill in the values.
3. Backfill, then verify (the Phase 1 pass condition):
   ```
   npm run backfill:races   # chain scan + race API hydration, resumable
   npm run backfill:pets    # full pet population, resumable
   npm run verify:phase1    # re-scans chain read-only, compares counts
   ```
4. Deploy to Vercel with the same env vars. `vercel.json` schedules the crons
   (races and ETH price every 5 minutes, pets rolling every 5 minutes, sales
   hourly). Vercel authenticates them with `CRON_SECRET` automatically.

`/api/health` reports table counts and last sync times.
