create table public.external_mappings (
  id uuid primary key default gen_random_uuid(),
  system public.external_system not null,
  entity_type text not null check (entity_type in ('brand', 'category', 'product', 'product_variant', 'media_asset', 'inventory_location', 'price_list')),
  internal_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 200),
  external_sku text,
  status public.external_mapping_status not null default 'active',
  source_version text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_mappings_external_unique unique (system, entity_type, external_id),
  constraint external_mappings_internal_unique unique (system, entity_type, internal_id)
);

create index external_mappings_internal_lookup_idx
  on public.external_mappings (entity_type, internal_id);
create index external_mappings_external_sku_idx
  on public.external_mappings (system, external_sku)
  where external_sku is not null;

create trigger external_mappings_set_updated_at before update on public.external_mappings
for each row execute function public.set_updated_at();

alter table public.external_mappings enable row level security;

comment on table public.external_mappings is
  'Controlled cross-system identity. internal_id is validated by domain services because it may target several entity tables.';
