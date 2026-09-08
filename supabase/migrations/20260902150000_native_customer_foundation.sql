-- B.3-A: multi-store and native customer foundation.
-- Local validation first. This migration does not seed stores or customer data.

create type public.customer_status as enum ('active', 'inactive', 'anonymized');
create type public.customer_type as enum ('individual', 'business');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_-]{1,49}$'),
  name text not null check (length(btrim(name)) between 1 and 150),
  status public.record_status not null default 'draft',
  default_currency char(3) not null default 'BRL'
    check (default_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'America/Sao_Paulo'
    check (length(btrim(timezone)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_code_unique unique (code)
);

create trigger stores_set_updated_at before update on public.stores
for each row execute function public.set_updated_at();

-- Customer profiles are global across stores. Store participation will be
-- expressed by carts/orders in later slices, avoiding duplicate PII profiles.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  status public.customer_status not null default 'active',
  customer_type public.customer_type not null default 'individual',
  email text check (email is null or length(btrim(email)) between 3 and 320),
  email_normalized text generated always as (lower(btrim(email))) stored,
  phone text check (phone is null or length(btrim(phone)) between 8 and 40),
  phone_normalized text check (
    phone_normalized is null or phone_normalized ~ '^\+[1-9][0-9]{7,14}$'
  ),
  tax_id_type text check (tax_id_type is null or tax_id_type in ('cpf', 'cnpj')),
  tax_id_ciphertext text check (
    tax_id_ciphertext is null or length(btrim(tax_id_ciphertext)) >= 32
  ),
  tax_id_fingerprint text check (
    tax_id_fingerprint is null or tax_id_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_tax_id_bundle_check check (
    (tax_id_type is null and tax_id_ciphertext is null and tax_id_fingerprint is null)
    or
    (tax_id_type is not null and tax_id_ciphertext is not null and tax_id_fingerprint is not null)
  ),
  constraint customers_anonymization_check check (
    (status = 'anonymized' and anonymized_at is not null
      and email is null and phone is null and phone_normalized is null
      and tax_id_type is null and tax_id_ciphertext is null and tax_id_fingerprint is null)
    or (status <> 'anonymized' and anonymized_at is null)
  )
);

create index customers_email_normalized_idx
  on public.customers (email_normalized, id)
  where email_normalized is not null;
create index customers_phone_normalized_idx
  on public.customers (phone_normalized, id)
  where phone_normalized is not null;
create index customers_tax_id_fingerprint_idx
  on public.customers (tax_id_fingerprint, id)
  where tax_id_fingerprint is not null;
create index customers_status_created_idx
  on public.customers (status, created_at, id);

create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();

create table public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  issuer text not null check (issuer ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  subject text not null check (length(btrim(subject)) between 1 and 255),
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_identities_issuer_subject_unique unique (issuer, subject)
);

create index customer_identities_customer_idx
  on public.customer_identities (customer_id, created_at, id);

create trigger customer_identities_set_updated_at before update on public.customer_identities
for each row execute function public.set_updated_at();

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  label text check (label is null or length(btrim(label)) between 1 and 80),
  recipient text not null check (length(btrim(recipient)) between 1 and 150),
  company text check (company is null or length(btrim(company)) between 1 and 150),
  street text not null check (length(btrim(street)) between 1 and 200),
  number text not null check (length(btrim(number)) between 1 and 30),
  complement text check (complement is null or length(btrim(complement)) between 1 and 150),
  neighborhood text not null check (length(btrim(neighborhood)) between 1 and 150),
  postal_code text not null check (length(btrim(postal_code)) between 1 and 20),
  city text not null check (length(btrim(city)) between 1 and 150),
  state text not null check (length(btrim(state)) between 1 and 100),
  country char(2) not null default 'BR' check (country ~ '^[A-Z]{2}$'),
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint customer_addresses_brazil_format_check check (
    country <> 'BR' or (postal_code ~ '^[0-9]{8}$' and state ~ '^[A-Z]{2}$')
  ),
  constraint customer_addresses_archive_check check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

create index customer_addresses_customer_status_idx
  on public.customer_addresses (customer_id, status, created_at, id);

create trigger customer_addresses_set_updated_at before update on public.customer_addresses
for each row execute function public.set_updated_at();

comment on table public.customers is
  'Global commerce customer profiles. Authentication identities and store participation are separate. Contains restricted PII.';
comment on column public.customers.tax_id_ciphertext is
  'Application-encrypted CPF/CNPJ only. Encryption key is server-only and never stored in PostgreSQL.';
comment on column public.customers.tax_id_fingerprint is
  'Lowercase SHA-256 HMAC for deterministic lookup. Never an unkeyed document hash.';
comment on table public.customer_identities is
  'Provider-neutral auth linkage. Passwords, OAuth secrets and session/access/refresh tokens are prohibited.';
comment on table public.customer_addresses is
  'Mutable reusable address. Future order history uses immutable order address snapshots instead.';

alter table public.stores enable row level security;
alter table public.customers enable row level security;
alter table public.customer_identities enable row level security;
alter table public.customer_addresses enable row level security;

revoke all on public.stores, public.customers, public.customer_identities,
  public.customer_addresses from public, anon, authenticated;

grant select, insert, update on public.stores, public.customers,
  public.customer_identities, public.customer_addresses to persi_app;
grant select, insert, update on public.stores, public.customers,
  public.customer_identities, public.customer_addresses to persi_worker;
grant select on public.stores to persi_readonly;

create policy stores_app on public.stores
  for all to persi_app using (true) with check (true);
create policy stores_worker on public.stores
  for all to persi_worker using (true) with check (true);
create policy stores_readonly on public.stores
  for select to persi_readonly using (true);

create policy customers_app on public.customers
  for all to persi_app using (true) with check (true);
create policy customers_worker on public.customers
  for all to persi_worker using (true) with check (true);
create policy customer_identities_app on public.customer_identities
  for all to persi_app using (true) with check (true);
create policy customer_identities_worker on public.customer_identities
  for all to persi_worker using (true) with check (true);
create policy customer_addresses_app on public.customer_addresses
  for all to persi_app using (true) with check (true);
create policy customer_addresses_worker on public.customer_addresses
  for all to persi_worker using (true) with check (true);
