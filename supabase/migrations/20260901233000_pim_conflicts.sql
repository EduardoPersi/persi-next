create table public.pim_conflicts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_key text not null check (attribute_key ~ '^[a-z][a-z0-9_]*$'),
  conflict_type text not null check (conflict_type in ('true_source_contradiction','unresolved_ambiguity')),
  status text not null default 'open' check (status in ('open','resolved')),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  detector_version text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pim_conflicts_resolution_consistency check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null and nullif(btrim(resolved_by),'') is not null)
  )
);

create unique index pim_conflicts_logical_identity_unique
  on public.pim_conflicts(product_id,attribute_key,conflict_type,source_fingerprint,evidence_fingerprint,detector_version);
create index pim_conflicts_open_queue_idx
  on public.pim_conflicts(status,created_at,product_id) where status = 'open';
create index pim_conflicts_product_idx on public.pim_conflicts(product_id,status,created_at);

create trigger pim_conflicts_set_updated_at before update on public.pim_conflicts
for each row execute function public.set_updated_at();

alter table public.pim_conflicts enable row level security;

comment on table public.pim_conflicts is
  'Deterministic PIM source conflicts. Creation is derived and idempotent; human resolution is explicit and auditable.';
comment on column public.pim_conflicts.metadata is
  'Safe structured evidence only. Must not contain SKU, GTIN, secrets, personal data, price or stock.';
