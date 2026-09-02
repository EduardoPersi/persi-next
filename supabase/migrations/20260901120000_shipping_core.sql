-- Shipping Core (Fase F.2): schema para cotação e futura execução de remessas
-- com o Melhor Envio como primeiro provider. orders/payments nativos ainda não
-- existem (write cutover de pedido está no fim de 03-migration-strategy.md,
-- sem prazo) — por isso shipments referencia o WC_Order via external_mappings
-- (entity_type 'order'), não uma FK direta a uma tabela orders que não existe.

alter type public.external_system add value if not exists 'melhor_envio';
alter type public.external_system add value if not exists 'mercadopago';

create type public.shipment_status as enum (
  'pending', 'preparing', 'ready_to_ship', 'posted', 'in_transit',
  'out_for_delivery', 'delivered', 'delivery_failed', 'delayed',
  'returning', 'returned', 'cancelled'
);

-- entity_type ganha 'order' e 'shipment': shipments.order_mapping_id aponta
-- para uma linha 'order' desta tabela (ver constraint composta abaixo);
-- 'shipment' fica disponível para quando o próprio Melhor Envio precisar de
-- um mapping (ex.: reconciliação por protocolo externo).
alter table public.external_mappings
  drop constraint if exists external_mappings_entity_type_check;
alter table public.external_mappings
  add constraint external_mappings_entity_type_check check (
    entity_type in (
      'brand', 'category', 'product', 'product_variant', 'media_asset',
      'inventory_location', 'price_list', 'order', 'shipment'
    )
  );

-- Necessária para a FK composta de shipments abaixo: (id) já é único pela PK,
-- mas uma FK só pode referenciar (id, entity_type) se esse par tiver um
-- unique constraint próprio — garante em nível de banco que shipments não
-- pode ser ligado, por engano, a um mapping que não seja do tipo 'order'.
alter table public.external_mappings
  add constraint external_mappings_id_entity_type_unique unique (id, entity_type);

create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  provider public.external_system not null,
  external_code text not null check (length(btrim(external_code)) between 1 and 50),
  carrier_name text not null check (length(btrim(carrier_name)) between 1 and 150),
  service_name text not null check (length(btrim(service_name)) between 1 and 150),
  -- Referência ao achado da auditoria do plugin: nem todo serviço aceita
  -- declared value/seguro (lista fixa de IDs no plugin legado); guardamos
  -- como dado, não como constante hardcoded no código novo.
  supports_insurance boolean not null default true,
  requires_pickup_agency boolean not null default false,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_methods_provider_code_unique unique (provider, external_code)
);

create trigger shipping_methods_set_updated_at before update on public.shipping_methods
for each row execute function public.set_updated_at();

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_mapping_id uuid not null,
  -- Fixo em 'order': existe só para permitir a FK composta abaixo, não é uma
  -- escolha por linha.
  order_mapping_entity_type text not null default 'order'
    check (order_mapping_entity_type = 'order'),
  shipping_method_id uuid references public.shipping_methods(id) on delete restrict,
  provider public.external_system not null,
  external_shipment_id text check (external_shipment_id is null or length(btrim(external_shipment_id)) between 1 and 100),
  external_protocol text,
  carrier_name text,
  service_name text,
  status public.shipment_status not null default 'pending',
  -- Diagnóstico: valor cru do provider, nunca usado para decisão de negócio.
  raw_provider_status text,
  tracking_code text,
  tracking_url text,
  quoted_amount_minor bigint not null check (quoted_amount_minor >= 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  promised_delivery_days integer check (promised_delivery_days is null or promised_delivery_days > 0),
  destination_postcode text not null check (destination_postcode ~ '^[0-9]{8}$'),
  estimated_delivery_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipments_order_mapping_fk
    foreign key (order_mapping_id, order_mapping_entity_type)
    references public.external_mappings (id, entity_type)
    on delete restrict,
  constraint shipments_external_unique unique (provider, external_shipment_id)
);

create index shipments_order_mapping_idx on public.shipments (order_mapping_id);
create index shipments_status_idx on public.shipments (status, last_event_at);

create trigger shipments_set_updated_at before update on public.shipments
for each row execute function public.set_updated_at();

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status public.shipment_status not null,
  raw_provider_status text,
  description text,
  occurred_at timestamptz not null,
  -- Chave de deduplicação do webhook do Melhor Envio (data.id, uuid) quando
  -- o evento chegar por webhook; nulo para eventos sintetizados internamente.
  external_event_id text,
  created_at timestamptz not null default now(),
  constraint shipment_events_external_unique unique (shipment_id, external_event_id)
);

create index shipment_events_shipment_timeline_idx
  on public.shipment_events (shipment_id, occurred_at desc);

comment on table public.shipment_events is
  'Somente inserção (append-only). external_event_id nulo é permitido mais de uma vez por shipment; não nulo é deduplicado.';

-- Credenciais OAuth2 do provider (Melhor Envio: authorization code, token
-- Bearer ~30 dias, refresh_token ~45 dias — ver lib/shipping/providers/melhor-envio).
-- Tokens nunca em texto puro: ciphertext gravado pela aplicação (AES-256-GCM,
-- chave em SHIPPING_MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY, nunca no banco).
create table public.shipping_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  provider public.external_system not null,
  environment text not null check (environment in ('sandbox', 'production')),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_provider_credentials_unique unique (provider, environment)
);

create trigger shipping_provider_credentials_set_updated_at
before update on public.shipping_provider_credentials
for each row execute function public.set_updated_at();

-- Cache curto de cotação (F.2, item 6). Escolhido Postgres em vez de Redis:
-- nenhuma dependência de cache está aprovada em AGENTS.md 4.2, e Postgres já
-- é infraestrutura aprovada do projeto — ver decisão documentada na PR.
create table public.shipping_quote_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  provider public.external_system not null,
  destination_postcode text not null check (destination_postcode ~ '^[0-9]{8}$'),
  response jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint shipping_quote_cache_key_unique unique (cache_key)
);

create index shipping_quote_cache_expires_idx on public.shipping_quote_cache (expires_at);

-- Roles técnicas (04-security.md). Só as três já referenciadas pela auditoria
-- de orders/payments; o restante do desenho de 0011_rls_roles (demais
-- domínios, credenciais de login) continua fora do escopo desta fase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'persi_app') then
    create role persi_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'persi_worker') then
    create role persi_worker nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'persi_readonly') then
    create role persi_readonly nologin;
  end if;
end
$$;

grant usage on schema public to persi_app, persi_worker, persi_readonly;

grant select, insert, update on
  public.shipping_methods,
  public.shipments,
  public.shipment_events,
  public.shipping_provider_credentials,
  public.shipping_quote_cache,
  public.external_mappings
to persi_app;

grant delete on public.shipping_quote_cache to persi_app;

grant select, insert, update, delete on
  public.shipping_methods,
  public.shipments,
  public.shipment_events,
  public.shipping_provider_credentials,
  public.shipping_quote_cache,
  public.external_mappings
to persi_worker;

grant select on
  public.shipping_methods,
  public.shipments,
  public.shipment_events,
  public.external_mappings
to persi_readonly;

alter table public.shipping_methods enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.shipping_provider_credentials enable row level security;
alter table public.shipping_quote_cache enable row level security;

create policy shipping_methods_app on public.shipping_methods
  for select to persi_app using (true);
create policy shipping_methods_worker on public.shipping_methods
  for all to persi_worker using (true) with check (true);
create policy shipping_methods_readonly on public.shipping_methods
  for select to persi_readonly using (true);

create policy shipments_select_app on public.shipments
  for select to persi_app using (true);
create policy shipments_insert_app on public.shipments
  for insert to persi_app with check (true);
create policy shipments_update_app on public.shipments
  for update to persi_app using (true) with check (true);
create policy shipments_worker on public.shipments
  for all to persi_worker using (true) with check (true);
create policy shipments_readonly on public.shipments
  for select to persi_readonly using (true);

create policy shipment_events_select_app on public.shipment_events
  for select to persi_app using (true);
create policy shipment_events_insert_app on public.shipment_events
  for insert to persi_app with check (true);
create policy shipment_events_worker on public.shipment_events
  for all to persi_worker using (true) with check (true);
create policy shipment_events_readonly on public.shipment_events
  for select to persi_readonly using (true);

-- Credenciais: sem policy para persi_readonly de propósito — suporte/analytics
-- não precisa ver nem o ciphertext.
create policy shipping_provider_credentials_app on public.shipping_provider_credentials
  for all to persi_app using (true) with check (true);
create policy shipping_provider_credentials_worker on public.shipping_provider_credentials
  for all to persi_worker using (true) with check (true);

create policy shipping_quote_cache_app on public.shipping_quote_cache
  for all to persi_app using (true) with check (true);
create policy shipping_quote_cache_worker on public.shipping_quote_cache
  for all to persi_worker using (true) with check (true);

-- external_mappings estava com RLS habilitada sem nenhuma policy (achado da
-- auditoria de orders/payments) — fechando retroativamente aqui, no mesmo
-- modelo aplicado às tabelas novas desta migration.
create policy external_mappings_app on public.external_mappings
  for all to persi_app using (true) with check (true);
create policy external_mappings_worker on public.external_mappings
  for all to persi_worker using (true) with check (true);
create policy external_mappings_readonly on public.external_mappings
  for select to persi_readonly using (true);

comment on table public.shipping_provider_credentials is
  'Tokens sempre cifrados pela aplicação antes do insert/update; a coluna nunca recebe texto puro. persi_readonly não tem policy aqui de propósito.';
comment on table public.shipping_quote_cache is
  'TTL curto por expires_at; sem job de limpeza nesta fase (linhas expiradas são simplesmente ignoradas nas leituras) — job de limpeza fica para a F.7 (resiliência).';
