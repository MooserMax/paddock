-- Paddock schema. Run once in the Supabase SQL editor of the dedicated
-- Paddock project before starting ingestion.
--
-- All reads and writes go through the server with the service role key.
-- RLS is enabled on every table with no policies, so the anon key can
-- access nothing even if it leaks.

create table if not exists pets (
  id bigint primary key,
  owner_address text,
  name text,
  img_url text,
  hatched boolean not null default false,
  gender text,
  rarity int,
  rarity_name text,
  faction int,
  faction_name text,
  races_run int,
  max_races int,
  wins int,
  elo numeric,
  start_min int,
  start_max int,
  speed_min int,
  speed_max int,
  stamina_min int,
  stamina_max int,
  finish_min int,
  finish_max int,
  reveals_start int,
  reveals_speed int,
  reveals_stamina int,
  reveals_finish int,
  last_synced_at timestamptz
);
create index if not exists pets_owner_idx on pets (owner_address);
create index if not exists pets_synced_idx on pets (last_synced_at asc nulls first);
create index if not exists pets_elo_idx on pets (elo desc nulls last);

create table if not exists pet_traits (
  pet_id bigint not null,
  trait_id text not null,
  trait_name text not null,
  tier int,
  primary key (pet_id, trait_id)
);
create index if not exists pet_traits_trait_idx on pet_traits (trait_id, tier);

create table if not exists races (
  race_id bigint primary key,
  field_size int,
  track_length int,
  race_temp text,
  entry_fee_wei numeric,
  creator text,
  payout_bps jsonb,
  fee_bps jsonb,
  resolved boolean not null default false,
  resolved_at timestamptz,
  race_start timestamptz,
  block_number bigint,
  hydrated boolean not null default false
);
create index if not exists races_hydration_idx on races (resolved, hydrated);
create index if not exists races_resolved_at_idx on races (resolved_at desc nulls last);
create index if not exists races_track_idx on races (track_length);

create table if not exists race_entries (
  race_id bigint not null,
  pet_id bigint not null,
  owner_address text,
  finish_position int,
  finish_time_ms int,
  payout_wei numeric,
  primary key (race_id, pet_id)
);
create index if not exists race_entries_pet_idx on race_entries (pet_id);
create index if not exists race_entries_owner_idx on race_entries (owner_address);

create table if not exists sales (
  tx_hash text not null,
  token_id bigint not null,
  price_eth numeric,
  price_usd numeric,
  sold_at timestamptz,
  marketplace text not null default 'opensea',
  primary key (tx_hash, token_id)
);
create index if not exists sales_token_idx on sales (token_id, sold_at desc);
create index if not exists sales_sold_at_idx on sales (sold_at desc);

create table if not exists eth_price (
  id int primary key default 1 check (id = 1),
  usd numeric not null,
  updated_at timestamptz not null default now()
);

create table if not exists sync_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists pet_scores (
  pet_id bigint primary key,
  reveal_progress numeric,
  traits_revealed int,
  traits_total int,
  confirmed_quality numeric,
  upside numeric,
  fit_500 numeric,
  fit_1200 numeric,
  fit_2400 numeric,
  fit_3000 numeric,
  best_distance int,
  next_milestone_in int,
  valuation_low_eth numeric,
  valuation_high_eth numeric,
  valuation_comps jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists pet_scores_confirmed_idx on pet_scores (confirmed_quality desc nulls last);
create index if not exists pet_scores_upside_idx on pet_scores (upside desc nulls last);

-- Resolved Gigaverse account handles (address -> primaryUsername). Populated by
-- the ingest layer for the bounded set of addresses the site displays; reads
-- fall back to the truncated address when an address is absent.
create table if not exists accounts (
  address text primary key,
  username text,
  last_checked_at timestamptz
);

alter table pets enable row level security;
alter table pet_traits enable row level security;
alter table races enable row level security;
alter table race_entries enable row level security;
alter table sales enable row level security;
alter table eth_price enable row level security;
alter table sync_state enable row level security;
alter table pet_scores enable row level security;
alter table accounts enable row level security;
