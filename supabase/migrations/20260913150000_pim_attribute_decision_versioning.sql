-- A3.4C: optimistic concurrency for attribute review decisions.
--
-- pim_attribute_reviews holds one row per candidate attribute_value, not one
-- row per (product, attribute) decision, so it cannot itself carry a single
-- version counter without an ABA-prone derivation (e.g. max(updated_at)
-- across rows that can be rewritten back to an earlier status). This table
-- tracks the version of the DECISION as a whole, mirroring the proven
-- pim_product_profiles.version pattern (increment-on-write, compared inside
-- the same transaction that holds the row lock).
--
-- The counter starts at 0 for every (product_id, attribute_id) pair,
-- including pairs that already have pim_attribute_reviews rows from before
-- this migration (e.g. the Tesoura and Martelo decisions) — no backfill and
-- no history rewrite. Version 0 simply means "no decision has been recorded
-- through the versioned pathway yet", which is true for every existing pair
-- at the moment this ships; the very next reviewPimAttribute call for any
-- of them advances it to 1 exactly like a brand-new decision would.
create table public.pim_attribute_decisions (
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, attribute_id)
);

create trigger pim_attribute_decisions_set_updated_at
  before update on public.pim_attribute_decisions
  for each row execute function public.set_updated_at();

alter table public.pim_attribute_decisions enable row level security;
