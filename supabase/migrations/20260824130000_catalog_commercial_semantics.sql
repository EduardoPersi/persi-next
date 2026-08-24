alter table public.products
  add column catalog_visibility text not null default 'visible' check (catalog_visibility in ('visible','catalog','search','hidden')),
  add column is_purchasable boolean not null default false,
  add column allows_backorder boolean not null default false,
  add column manage_stock boolean not null default false,
  add column woo_stock_status text not null default 'outofstock' check (woo_stock_status in ('instock','outofstock','onbackorder')),
  add column average_rating numeric(3,2) not null default 0 check (average_rating between 0 and 5),
  add column review_count integer not null default 0 check (review_count >= 0),
  add column is_featured boolean not null default false,
  add column popularity bigint not null default 0 check (popularity >= 0),
  add column has_free_shipping boolean not null default false;

alter table public.brands add column image_url text, add column image_alt text;
alter table public.categories add column image_url text, add column image_alt text;

create table public.product_tags (
  id uuid primary key default gen_random_uuid(),
  woo_external_id bigint not null unique,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.product_tag_assignments (
  product_id uuid not null references public.products(id) on delete cascade,
  tag_id uuid not null references public.product_tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(product_id,tag_id)
);
create index product_tag_assignments_tag_idx on public.product_tag_assignments(tag_id,product_id);
create index products_commercial_listing_idx on public.products(status,catalog_visibility,is_purchasable,id);
create index products_popularity_idx on public.products(popularity desc,id);
create index products_rating_idx on public.products(average_rating desc,review_count desc,id);
create trigger product_tags_set_updated_at before update on public.product_tags for each row execute function public.set_updated_at();
alter table public.product_tags enable row level security;
alter table public.product_tag_assignments enable row level security;

comment on column public.products.is_purchasable is 'Replicated Woo semantic flag; never inferred from PostgreSQL stock alone.';
comment on column public.products.has_free_shipping is 'Membership of Woo shipping class slug frete-gratis; does not calculate checkout shipping.';
