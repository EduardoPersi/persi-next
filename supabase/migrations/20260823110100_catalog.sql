create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  website_url text,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  constraint brands_slug_unique unique (slug),
  constraint brands_publication_check check (status <> 'active' or published_at is not null)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  sort_order integer not null default 0,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id),
  constraint categories_publication_check check (status <> 'active' or published_at is not null)
);

create unique index categories_parent_slug_unique
  on public.categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index categories_parent_sort_idx on public.categories (parent_id, sort_order, id);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  kind public.media_kind not null,
  storage_provider text not null check (length(btrim(storage_provider)) between 1 and 50),
  storage_path text not null check (length(btrim(storage_path)) > 0),
  public_url text,
  mime_type text not null check (length(btrim(mime_type)) between 1 and 150),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  alt_text text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_assets_provider_path_unique unique (storage_provider, storage_path)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id) on delete restrict,
  primary_category_id uuid references public.categories(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 300),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  short_description text,
  description text,
  product_type text not null default 'simple' check (product_type in ('simple', 'variable')),
  tax_class text,
  warranty text,
  country_of_origin char(2) check (country_of_origin is null or country_of_origin ~ '^[A-Z]{2}$'),
  manufacturer_reference text,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  constraint products_slug_unique unique (slug),
  constraint products_publication_check check (status <> 'active' or published_at is not null)
);

create index products_brand_status_idx on public.products (brand_id, status, id);
create index products_primary_category_idx on public.products (primary_category_id, id);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

create table public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create index product_categories_category_product_idx
  on public.product_categories (category_id, product_id);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null check (length(btrim(sku)) between 1 and 100),
  sku_normalized text generated always as (upper(btrim(sku))) stored,
  gtin text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  manufacturer_code text,
  weight_value numeric(18,6) check (weight_value is null or weight_value >= 0),
  weight_unit_code text check (weight_unit_code is null or length(weight_unit_code) between 1 and 16),
  width_value numeric(18,6) check (width_value is null or width_value >= 0),
  height_value numeric(18,6) check (height_value is null or height_value >= 0),
  length_value numeric(18,6) check (length_value is null or length_value >= 0),
  dimension_unit_code text check (dimension_unit_code is null or length(dimension_unit_code) between 1 and 16),
  physical_unit text not null default 'unit' check (length(btrim(physical_unit)) between 1 and 30),
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint product_variants_sku_unique unique (sku_normalized)
);

create unique index product_variants_gtin_unique
  on public.product_variants (gtin) where gtin is not null;
create index product_variants_product_status_idx
  on public.product_variants (product_id, status, id);

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  role text not null default 'gallery' check (role in ('primary', 'gallery', 'video', 'document', 'manual', 'technical_sheet')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index product_media_usage_unique
  on public.product_media (product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), media_asset_id, role);
create index product_media_product_sort_idx on public.product_media (product_id, sort_order, id);
create index product_media_variant_idx on public.product_media (variant_id) where variant_id is not null;

create trigger brands_set_updated_at before update on public.brands
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger media_assets_set_updated_at before update on public.media_assets
for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();

create function public.validate_product_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_product_id uuid;
begin
  if tg_table_name = 'products' then
    target_product_id := new.id;
  elsif tg_op = 'DELETE' then
    target_product_id := old.product_id;
  else
    target_product_id := new.product_id;
  end if;

  if exists (
    select 1 from public.products product
    where product.id = target_product_id and product.status = 'active'
      and not exists (
        select 1 from public.product_variants variant
        where variant.product_id = product.id and variant.status = 'active'
      )
  ) then
    raise exception using errcode = '23514', message = 'active_product_requires_active_variant';
  end if;

  if exists (
    select 1 from public.products product
    where product.id = target_product_id and product.primary_category_id is not null
      and not exists (
        select 1 from public.product_categories relation
        where relation.product_id = product.id and relation.category_id = product.primary_category_id
      )
  ) then
    raise exception using errcode = '23514', message = 'primary_category_must_belong_to_product';
  end if;
  return new;
end;
$$;

create constraint trigger products_validate_publication
after insert or update of status, primary_category_id on public.products
deferrable initially deferred
for each row execute function public.validate_product_publication();

create constraint trigger product_variants_validate_publication
after insert or update of status, product_id or delete on public.product_variants
deferrable initially deferred
for each row execute function public.validate_product_publication();

create function public.validate_product_media_variant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.variant_id is not null and not exists (
    select 1 from public.product_variants
    where id = new.variant_id and product_id = new.product_id
  ) then
    raise exception using errcode = '23514', message = 'media_variant_belongs_to_another_product';
  end if;
  return new;
end;
$$;

create trigger product_media_validate_variant
before insert or update on public.product_media
for each row execute function public.validate_product_media_variant();

alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.media_assets enable row level security;
alter table public.products enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_media enable row level security;

comment on table public.categories is
  'Adjacency-list tree. Self-parenting is blocked in SQL; application writes must reject deeper cycles in one transaction.';
