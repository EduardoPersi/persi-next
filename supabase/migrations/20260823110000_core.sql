create schema if not exists extensions;

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.record_status as enum ('draft', 'active', 'inactive', 'archived');
create type public.media_kind as enum ('image', 'video', 'document', 'manual', 'technical_sheet');
create type public.attribute_data_type as enum (
  'text', 'boolean', 'integer', 'decimal', 'option', 'measurement', 'composite_measurement'
);
create type public.attribute_cardinality as enum ('single', 'multiple');
create type public.inventory_movement_type as enum (
  'purchase', 'sale', 'reservation', 'release', 'adjustment', 'return', 'transfer', 'erp_sync'
);
create type public.inventory_reservation_status as enum ('active', 'released', 'confirmed', 'expired', 'cancelled');
create type public.external_system as enum ('woocommerce', 'olist', 'banco_inter', 'pagbank');
create type public.external_mapping_status as enum ('active', 'conflict', 'inactive');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Maintains updated_at in UTC through timestamptz; database timezone is not used for storage.';
