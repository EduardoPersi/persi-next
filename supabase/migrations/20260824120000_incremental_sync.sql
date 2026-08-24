alter table public.external_mappings
  add column source_changed_at timestamptz;

create index external_mappings_source_changed_idx
  on public.external_mappings (system, entity_type, source_changed_at, external_id);

create table public.integration_inbox (
  id uuid primary key default gen_random_uuid(),
  source public.external_system not null,
  event_type text not null check (length(btrim(event_type)) between 1 and 100),
  external_event_id text not null check (length(btrim(external_event_id)) between 1 and 200),
  entity_type text not null check (entity_type in ('product', 'category', 'brand')),
  external_entity_id text not null check (length(btrim(external_entity_id)) between 1 and 200),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[a-f0-9]{64}$'),
  source_changed_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'processed', 'dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error_code text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  result text check (result is null or result in ('insert', 'update', 'noop', 'archive', 'conflict')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_inbox_event_unique unique (source, external_event_id)
);

create index integration_inbox_work_idx
  on public.integration_inbox (next_attempt_at, received_at, id)
  where status in ('pending', 'retry');
create index integration_inbox_entity_idx
  on public.integration_inbox (source, entity_type, external_entity_id, source_changed_at desc);

create trigger integration_inbox_set_updated_at before update on public.integration_inbox
for each row execute function public.set_updated_at();

create table public.integration_checkpoints (
  id uuid primary key default gen_random_uuid(),
  source public.external_system not null,
  stream text not null check (length(btrim(stream)) between 1 and 100),
  cursor_value text,
  cursor_changed_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_checkpoints_stream_unique unique (source, stream)
);

create trigger integration_checkpoints_set_updated_at before update on public.integration_checkpoints
for each row execute function public.set_updated_at();

alter table public.integration_inbox enable row level security;
alter table public.integration_checkpoints enable row level security;

create function public.immutable_unaccent_lower(value text)
returns text language sql immutable parallel safe strict
as $$ select lower(extensions.unaccent(value)) $$;

create table public.catalog_search_synonyms (
  group_code text not null,
  alias text not null,
  normalized_alias text generated always as (public.immutable_unaccent_lower(alias)) stored,
  primary key (group_code, alias)
);

insert into public.catalog_search_synonyms(group_code,alias) values
  ('pipe','cano'),('pipe','tubo'),
  ('water_tank','caixa d agua'),('water_tank','caixa d''água'),('water_tank','reservatorio'),('water_tank','reservatório'),
  ('thread_seal','fita veda rosca'),('thread_seal','veda rosca'),('thread_seal','teflon'),
  ('submersible_pump','bomba sapo'),('submersible_pump','bomba submersa'),
  ('float_valve','torneira boia'),('float_valve','boia para caixa d agua'),('float_valve','boia para caixa d''água'),
  ('heat_lamp','esquenta pinto'),('heat_lamp','lampada de aquecimento'),('heat_lamp','lâmpada de aquecimento'),
  ('heat_lamp','lampada infravermelha'),('heat_lamp','lâmpada infravermelha');

create index catalog_search_synonyms_normalized_idx on public.catalog_search_synonyms(normalized_alias);
alter table public.catalog_search_synonyms enable row level security;

create function public.catalog_search(search_query text, result_limit integer default 20)
returns table(product_id uuid, score numeric)
language sql stable security invoker set search_path = public
as $$
  with input as (
    select public.immutable_unaccent_lower(btrim(search_query)) q
  ), expanded as (
    select q term from input
    union
    select replace(i.q, hit.normalized_alias, replacement.normalized_alias)
    from input i
    join catalog_search_synonyms hit on i.q like '%' || hit.normalized_alias || '%'
    join catalog_search_synonyms replacement on replacement.group_code=hit.group_code
  ), documents as (
    select p.id,p.name,v.sku_normalized,v.gtin,b.name brand,
      concat_ws(' ',p.name,p.short_description,p.description,b.name,
        (select string_agg(c.name,' ') from product_categories pc join categories c on c.id=pc.category_id where pc.product_id=p.id),
        (select string_agg(av.display_value,' ') from product_attribute_values pav join attribute_values av on av.id=pav.attribute_value_id where pav.product_id=p.id)) document
    from products p join product_variants v on v.product_id=p.id left join brands b on b.id=p.brand_id
    where p.status='active' and v.status='active'
  ), ranked as (
    select d.id,
      max((case when public.immutable_unaccent_lower(d.sku_normalized)=i.q then 3000 else 0 end)+
          (case when public.immutable_unaccent_lower(d.gtin)=i.q then 2900 else 0 end)+
          (case when public.immutable_unaccent_lower(d.name)=i.q then 1000 else 0 end)+
          (case when public.immutable_unaccent_lower(d.name) like i.q||'%' then 600 else 0 end)+
          (case when public.immutable_unaccent_lower(d.name) like '%'||i.q||'%' then 400 else 0 end)+
          (case when public.immutable_unaccent_lower(coalesce(d.brand,'')) like '%'||i.q||'%' then 250 else 0 end)+
          (case when public.immutable_unaccent_lower(d.document) like '%'||e.term||'%' then 80 else 0 end)+
          extensions.similarity(public.immutable_unaccent_lower(d.name),i.q)*100)::numeric score
    from documents d cross join input i cross join expanded e
    where public.immutable_unaccent_lower(d.document) like '%'||e.term||'%'
       or public.immutable_unaccent_lower(d.sku_normalized)=i.q or public.immutable_unaccent_lower(d.gtin)=i.q
       or extensions.similarity(public.immutable_unaccent_lower(d.name),i.q)>=0.2
    group by d.id
  ) select id,score from ranked order by score desc,id limit greatest(1,least(result_limit,100));
$$;

comment on table public.integration_inbox is
  'Server-only durable signals for idempotent Woo to PostgreSQL catalog synchronization; no secrets or full Woo payloads.';
comment on table public.integration_checkpoints is
  'Persistent reconciliation cursors. Woo remains authoritative and events trigger a fresh official read.';
