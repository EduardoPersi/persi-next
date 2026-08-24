create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9]*$'),
  symbol text not null check (length(btrim(symbol)) between 1 and 20),
  name text not null check (length(btrim(name)) between 1 and 100),
  dimension text not null check (dimension in ('length', 'mass', 'volume', 'power', 'voltage', 'current', 'pressure', 'count')),
  base_unit_id uuid references public.units(id) on delete restrict,
  conversion_numerator bigint check (conversion_numerator is null or conversion_numerator > 0),
  conversion_denominator bigint check (conversion_denominator is null or conversion_denominator > 0),
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_code_unique unique (code),
  constraint units_conversion_pair_check check (
    (conversion_numerator is null) = (conversion_denominator is null)
  ),
  constraint units_not_own_base check (base_unit_id is null or base_unit_id <> id)
);

create table public.attributes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(btrim(name)) between 1 and 150),
  description text,
  data_type public.attribute_data_type not null,
  cardinality public.attribute_cardinality not null default 'single',
  unit_dimension text check (unit_dimension is null or unit_dimension in ('length', 'mass', 'volume', 'power', 'voltage', 'current', 'pressure', 'count')),
  is_commercial boolean not null default false,
  is_technical boolean not null default false,
  is_variation boolean not null default false,
  is_filterable boolean not null default false,
  is_searchable boolean not null default false,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attributes_code_unique unique (code),
  constraint attributes_classification_check check (is_commercial or is_technical),
  constraint attributes_measurement_dimension_check check (
    data_type not in ('measurement', 'composite_measurement') or unit_dimension is not null
  )
);

create table public.attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  display_value text not null check (length(btrim(display_value)) > 0),
  normalized_text text,
  text_value text,
  boolean_value boolean,
  integer_value bigint,
  decimal_value numeric(30,12),
  option_code text,
  measurement_numerator bigint,
  measurement_denominator bigint,
  measurement_unit_id uuid references public.units(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attribute_values_measurement_fraction_check check (
    measurement_denominator is null or measurement_denominator > 0
  ),
  constraint attribute_values_option_code_check check (
    option_code is null or option_code ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'
  ),
  constraint attribute_values_shape_check check (
    num_nonnulls(text_value, boolean_value, integer_value, decimal_value, option_code,
      measurement_numerator, measurement_unit_id) <= 3
  )
);

create unique index attribute_values_option_unique
  on public.attribute_values (attribute_id, option_code) where option_code is not null;
create index attribute_values_attribute_idx on public.attribute_values (attribute_id, id);
create index attribute_values_normalized_trgm_idx
  on public.attribute_values using gin (normalized_text extensions.gin_trgm_ops)
  where normalized_text is not null;

create table public.measurement_components (
  id uuid primary key default gen_random_uuid(),
  attribute_value_id uuid not null references public.attribute_values(id) on delete cascade,
  position smallint not null check (position > 0),
  semantic_role text not null check (semantic_role ~ '^[a-z][a-z0-9_]*$'),
  numerator bigint not null check (numerator >= 0),
  denominator bigint not null check (denominator > 0),
  unit_id uuid not null references public.units(id) on delete restrict,
  display_value text not null check (length(btrim(display_value)) > 0),
  created_at timestamptz not null default now(),
  constraint measurement_components_position_unique unique (attribute_value_id, position),
  constraint measurement_components_role_unique unique (attribute_value_id, semantic_role)
);

create index measurement_components_query_idx
  on public.measurement_components (unit_id, numerator, denominator, attribute_value_id);

create table public.product_attribute_values (
  product_id uuid not null references public.products(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  attribute_value_id uuid not null references public.attribute_values(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, attribute_id, attribute_value_id)
);

create index product_attribute_values_value_idx
  on public.product_attribute_values (attribute_value_id, product_id);

create table public.variant_attribute_values (
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  attribute_value_id uuid not null references public.attribute_values(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (variant_id, attribute_id, attribute_value_id)
);

create index variant_attribute_values_value_idx
  on public.variant_attribute_values (attribute_value_id, variant_id);

create function public.validate_attribute_value_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_type public.attribute_data_type;
begin
  select data_type into expected_type from public.attributes where id = new.attribute_id;
  if expected_type is null then
    raise exception using errcode = '23503', message = 'attribute_not_found';
  end if;

  if (expected_type = 'text' and new.text_value is null)
    or (expected_type = 'boolean' and new.boolean_value is null)
    or (expected_type = 'integer' and new.integer_value is null)
    or (expected_type = 'decimal' and new.decimal_value is null)
    or (expected_type = 'option' and new.option_code is null)
    or (expected_type = 'measurement' and
      (new.measurement_numerator is null or new.measurement_denominator is null or new.measurement_unit_id is null))
    or (expected_type = 'composite_measurement' and new.normalized_text is null) then
    raise exception using errcode = '23514', message = 'attribute_value_does_not_match_attribute_type';
  end if;

  if expected_type <> 'text' and new.text_value is not null
    or expected_type <> 'boolean' and new.boolean_value is not null
    or expected_type <> 'integer' and new.integer_value is not null
    or expected_type <> 'decimal' and new.decimal_value is not null
    or expected_type <> 'option' and new.option_code is not null
    or expected_type <> 'measurement' and
      (new.measurement_numerator is not null or new.measurement_denominator is not null or new.measurement_unit_id is not null) then
    raise exception using errcode = '23514', message = 'attribute_value_contains_wrong_typed_value';
  end if;

  return new;
end;
$$;

create function public.validate_attribute_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  entity_id uuid;
  allows_multiple boolean;
begin
  if not exists (
    select 1 from public.attribute_values
    where id = new.attribute_value_id and attribute_id = new.attribute_id
  ) then
    raise exception using errcode = '23514', message = 'attribute_value_belongs_to_another_attribute';
  end if;

  entity_id := coalesce(
    nullif(to_jsonb(new)->>'product_id', '')::uuid,
    nullif(to_jsonb(new)->>'variant_id', '')::uuid
  );
  select cardinality = 'multiple' and not is_variation
    into allows_multiple from public.attributes where id = new.attribute_id;

  if not allows_multiple then
    perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || entity_id::text || ':' || new.attribute_id::text, 0));
    if tg_table_name = 'product_attribute_values' and exists (
      select 1 from public.product_attribute_values
      where product_id = entity_id and attribute_id = new.attribute_id
        and attribute_value_id <> new.attribute_value_id
    ) then
      raise exception using errcode = '23505', message = 'single_attribute_has_multiple_values';
    elsif tg_table_name = 'variant_attribute_values' and exists (
      select 1 from public.variant_attribute_values
      where variant_id = entity_id and attribute_id = new.attribute_id
        and attribute_value_id <> new.attribute_value_id
    ) then
      raise exception using errcode = '23505', message = 'single_attribute_has_multiple_values';
    end if;
  end if;
  return new;
end;
$$;

create function public.validate_measurement_component()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.attribute_values value
    join public.attributes attribute on attribute.id = value.attribute_id
    where value.id = new.attribute_value_id
      and attribute.data_type = 'composite_measurement'
  ) then
    raise exception using errcode = '23514', message = 'components_require_composite_measurement';
  end if;
  return new;
end;
$$;

create trigger attribute_values_validate_shape
before insert or update on public.attribute_values
for each row execute function public.validate_attribute_value_shape();
create trigger product_attribute_values_validate
before insert or update on public.product_attribute_values
for each row execute function public.validate_attribute_assignment();
create trigger variant_attribute_values_validate
before insert or update on public.variant_attribute_values
for each row execute function public.validate_attribute_assignment();
create trigger measurement_components_validate
before insert or update on public.measurement_components
for each row execute function public.validate_measurement_component();

create trigger units_set_updated_at before update on public.units
for each row execute function public.set_updated_at();
create trigger attributes_set_updated_at before update on public.attributes
for each row execute function public.set_updated_at();
create trigger attribute_values_set_updated_at before update on public.attribute_values
for each row execute function public.set_updated_at();

alter table public.units enable row level security;
alter table public.attributes enable row level security;
alter table public.attribute_values enable row level security;
alter table public.measurement_components enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.variant_attribute_values enable row level security;
