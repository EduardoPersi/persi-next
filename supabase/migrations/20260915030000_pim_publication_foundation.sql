-- A3.5E-P3-A: PIM publication foundation.
--
-- Problem (found by A3.5E-P2-X's read-only code audit): attributes.status
-- ('draft'/'active'/'inactive'/'archived') is the ONLY publication signal
-- that exists today, and it is whole-ATTRIBUTE granularity -- flipping one
-- attribute's status publishes it for every product at once. There is no
-- way to publish "product A / material" without also publishing "product A
-- / comprimento" or "product B / material". This migration adds the
-- missing granularity: PERSISTED (a row exists in product_attribute_values)
-- is not ELIGIBLE (it passed the semantic/human gates) is not PUBLISHED
-- (an explicit publication decision exists and is currently in force) --
-- three distinct concepts that must never be conflated.
--
-- Design: a CURRENT-STATE table (pim_attribute_publications, one row per
-- product_id+attribute_id+attribute_value_id triple, toggled in place
-- between 'published'/'unpublished') plus the EXISTING pim_audit_log for
-- the immutable event history -- reusing pim_audit_log rather than adding a
-- second, redundant ledger, consistent with how every other PIM write in
-- this project (ATTRIBUTE_BACKFILLED, ATTRIBUTE_REMEDIATION_REMOVED, ...)
-- has always recorded its history. A batch (pim_publication_batches) gives
-- "revert exactly canary X" a real identity to act on instead of an
-- inference from timestamps.
--
-- This migration is schema-only. Nothing here changes what the storefront
-- serves (services/catalog/postgres.ts is untouched) and no row is written
-- by this migration itself.

create type public.pim_publication_state as enum ('published', 'unpublished');
create type public.pim_publication_batch_kind as enum ('canary', 'full');
create type public.pim_publication_batch_status as enum ('active', 'rolled_back');

create table public.pim_publication_batches (
  id uuid primary key default gen_random_uuid(),
  kind public.pim_publication_batch_kind not null,
  status public.pim_publication_batch_status not null default 'active',
  -- Sha256 of the sorted, canonical (product_id:attribute_id:attribute_value_id)
  -- membership list. Lets publishBatch() detect "same batch id submitted
  -- again with the SAME membership" (idempotent no-op) versus "same batch
  -- id submitted with DIFFERENT membership" (deterministic rejection,
  -- never a silent overwrite of batch identity).
  member_fingerprint text not null,
  baseline_reference text,
  created_by text not null,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by text,
  note text,
  constraint pim_publication_batches_rollback_check check (
    (status = 'active' and rolled_back_at is null and rolled_back_by is null)
    or (status = 'rolled_back' and rolled_back_at is not null and rolled_back_by is not null)
  )
);

create table public.pim_attribute_publications (
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  attribute_value_id uuid not null references public.attribute_values(id) on delete restrict,
  state public.pim_publication_state not null,
  batch_id uuid not null references public.pim_publication_batches(id) on delete restrict,
  published_at timestamptz,
  unpublished_at timestamptz,
  actor_reference text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, attribute_id, attribute_value_id),
  constraint pim_attribute_publications_timestamp_check check (
    (state = 'published' and published_at is not null)
    or (state = 'unpublished' and unpublished_at is not null)
  )
);
create index pim_attribute_publications_batch_idx on public.pim_attribute_publications(batch_id);
-- Read-model lookup shape: "give me every currently published row for this product".
create index pim_attribute_publications_published_idx on public.pim_attribute_publications(product_id) where state = 'published';

create trigger pim_attribute_publications_set_updated_at
  before update on public.pim_attribute_publications
  for each row execute function public.set_updated_at();

alter table public.pim_publication_batches enable row level security;
alter table public.pim_attribute_publications enable row level security;

-- No policies are added for anon/authenticated on either table (matching
-- every other PIM table in this project -- pim_attribute_reviews,
-- pim_attribute_decisions, pim_audit_log, pim_conflicts, pim_suggestions,
-- pim_product_profiles). RLS enabled with zero policies fails closed for
-- anon/authenticated; only the server-side service-role connection
-- (getDatabase(), the same one every lib/pim/*.ts module already uses)
-- can read or write these tables.
