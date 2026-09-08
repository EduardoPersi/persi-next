-- R1D: immutable, local shipping authority for checkout readiness.

create table public.checkout_shipping_evidence (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 16 and 200),
  shipping_method_id uuid references public.shipping_methods(id) on delete restrict,
  provider public.external_system not null,
  external_service_code text not null check (length(btrim(external_service_code)) between 1 and 100),
  carrier_name text not null check (length(btrim(carrier_name)) between 1 and 150),
  service_name text not null check (length(btrim(service_name)) between 1 and 150),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  destination_postcode text not null check (destination_postcode ~ '^[0-9]{8}$'),
  destination_fingerprint text not null check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  logistics_inputs_fingerprint text not null check (logistics_inputs_fingerprint ~ '^[0-9a-f]{64}$'),
  logistics_version text not null default 'shipping-authority-v1' check (logistics_version='shipping-authority-v1'),
  estimated_delivery_days integer check (estimated_delivery_days is null or estimated_delivery_days > 0),
  provider_quote_reference text check (provider_quote_reference is null or length(btrim(provider_quote_reference)) between 1 and 200),
  quoted_at timestamptz not null,
  expires_at timestamptz not null,
  canonical_fingerprint text not null check (canonical_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint checkout_shipping_evidence_expiry_check check (expires_at > quoted_at),
  constraint checkout_shipping_evidence_idempotency_unique unique(checkout_session_id,idempotency_key),
  constraint checkout_shipping_evidence_id_checkout_unique unique(id,checkout_session_id),
  constraint checkout_shipping_evidence_id_checkout_store_unique unique(id,checkout_session_id,store_id)
);

alter table public.checkout_shipping_quotes add column shipping_evidence_id uuid;
alter table public.checkout_shipping_quotes add constraint checkout_shipping_quotes_evidence_fk
  foreign key(shipping_evidence_id,checkout_session_id) references public.checkout_shipping_evidence(id,checkout_session_id) on delete restrict;
create index checkout_shipping_quotes_evidence_idx on public.checkout_shipping_quotes(shipping_evidence_id);

create function public.canonical_checkout_logistics_fingerprint(
  p_evidence_id uuid,p_checkout_id uuid,p_store_id uuid,p_shipping_method_id uuid,p_provider public.external_system,
  p_external_service_code text,p_carrier_name text,p_service_name text,p_amount_minor bigint,p_currency char(3),
  p_destination_postcode text,p_destination_fingerprint text,p_logistics_inputs_fingerprint text,p_logistics_version text,
  p_quoted_at timestamptz,p_expires_at timestamptz,p_estimated_delivery_days integer,p_provider_quote_reference text
) returns text language plpgsql stable set search_path='' as $$
declare v_preimage jsonb;
begin
 if p_evidence_id is null or p_checkout_id is null or p_store_id is null or p_provider is null
    or p_external_service_code is null or btrim(p_external_service_code)=''
    or p_carrier_name is null or btrim(p_carrier_name)=''
    or p_service_name is null or btrim(p_service_name)=''
    or p_amount_minor is null or p_amount_minor<0 or p_currency is null
    or p_destination_postcode is null or p_destination_fingerprint is null
    or p_logistics_inputs_fingerprint is null or p_logistics_version is null
    or p_quoted_at is null or p_expires_at is null then
   raise exception using errcode='22023',message='INVALID_SHIPPING_FINGERPRINT_INPUT';
 end if;
 v_preimage:=jsonb_build_array(
   jsonb_build_array('contract','checkout-shipping-authority-v1'),
   jsonb_build_array('evidence_id',p_evidence_id),
   jsonb_build_array('checkout_id',p_checkout_id),
   jsonb_build_array('store_id',p_store_id),
   jsonb_build_array('shipping_method_id',to_jsonb(p_shipping_method_id)),
   jsonb_build_array('provider',p_provider),
   jsonb_build_array('external_service_code',lower(btrim(p_external_service_code))),
   jsonb_build_array('carrier_name',lower(btrim(p_carrier_name))),
   jsonb_build_array('service_name',lower(btrim(p_service_name))),
   jsonb_build_array('amount_minor',p_amount_minor),
   jsonb_build_array('currency',btrim(p_currency)),
   jsonb_build_array('destination_postcode',p_destination_postcode),
   jsonb_build_array('destination_fingerprint',p_destination_fingerprint),
   jsonb_build_array('logistics_inputs_fingerprint',p_logistics_inputs_fingerprint),
   jsonb_build_array('logistics_version',p_logistics_version),
   jsonb_build_array('quoted_at',to_char(p_quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
   jsonb_build_array('expires_at',to_char(p_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
   jsonb_build_array('estimated_delivery_days',to_jsonb(p_estimated_delivery_days)),
   jsonb_build_array('provider_quote_reference',to_jsonb(case when p_provider_quote_reference is null then null else btrim(p_provider_quote_reference) end))
 );
 return encode(extensions.digest(convert_to(v_preimage::text,'UTF8'),'sha256'),'hex');
end $$;

create function public.reject_checkout_shipping_evidence_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='CHECKOUT_SHIPPING_EVIDENCE_IMMUTABLE'; end $$;
create trigger checkout_shipping_evidence_immutable before update or delete on public.checkout_shipping_evidence
for each row execute function public.reject_checkout_shipping_evidence_mutation();

create function public.create_native_shipping_evidence(
 p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint,p_idempotency_key text,
 p_shipping_method_id uuid,p_provider public.external_system,p_external_service_code text,p_carrier_name text,p_service_name text,
 p_amount_minor bigint,p_destination_postcode text,p_destination_fingerprint text,p_logistics_inputs_fingerprint text,
 p_expires_at timestamptz,p_estimated_delivery_days integer default null,p_provider_quote_reference text default null
) returns public.checkout_shipping_evidence language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; e public.checkout_shipping_evidence; v_id uuid:=gen_random_uuid(); v_now timestamptz:=statement_timestamp(); v_version text:='shipping-authority-v1'; v_fp text;
begin
 select * into s from public.checkout_sessions where id=p_checkout_id for update;
 if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
 if s.status<>'validating' or not s.shipping_required then raise exception using errcode='23514',message='CHECKOUT_STATE_INVALID'; end if;
 if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
 if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
    (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(select 1 from public.carts c where c.id=s.cart_id and c.store_id=s.store_id and c.guest_token_fingerprint=p_guest_fingerprint))) then raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED'; end if;
 if s.pii_destination_fingerprint is null or s.pii_destination_fingerprint<>p_destination_fingerprint or p_expires_at<=v_now then raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID'; end if;
 select * into e from public.checkout_shipping_evidence where checkout_session_id=s.id and idempotency_key=p_idempotency_key;
 if found then
   if e.shipping_method_id is distinct from p_shipping_method_id or e.provider<>p_provider
      or e.external_service_code<>lower(btrim(p_external_service_code)) or e.carrier_name<>lower(btrim(p_carrier_name)) or e.service_name<>lower(btrim(p_service_name))
      or e.amount_minor<>p_amount_minor or e.currency<>s.currency or e.destination_postcode<>p_destination_postcode
      or e.destination_fingerprint<>p_destination_fingerprint or e.logistics_inputs_fingerprint<>p_logistics_inputs_fingerprint
      or e.expires_at<>p_expires_at or e.estimated_delivery_days is distinct from p_estimated_delivery_days
      or e.provider_quote_reference is distinct from (case when p_provider_quote_reference is null then null else btrim(p_provider_quote_reference) end) then
     raise exception using errcode='23505',message='SHIPPING_EVIDENCE_IDEMPOTENCY_CONFLICT';
   end if;
   return e;
 end if;
 v_fp:=public.canonical_checkout_logistics_fingerprint(v_id,s.id,s.store_id,p_shipping_method_id,p_provider,p_external_service_code,p_carrier_name,p_service_name,p_amount_minor,s.currency,p_destination_postcode,p_destination_fingerprint,p_logistics_inputs_fingerprint,v_version,v_now,p_expires_at,p_estimated_delivery_days,p_provider_quote_reference);
 insert into public.checkout_shipping_evidence(id,checkout_session_id,store_id,idempotency_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,destination_postcode,destination_fingerprint,logistics_inputs_fingerprint,logistics_version,estimated_delivery_days,provider_quote_reference,quoted_at,expires_at,canonical_fingerprint)
 values(v_id,s.id,s.store_id,p_idempotency_key,p_shipping_method_id,p_provider,lower(btrim(p_external_service_code)),lower(btrim(p_carrier_name)),lower(btrim(p_service_name)),p_amount_minor,s.currency,p_destination_postcode,p_destination_fingerprint,p_logistics_inputs_fingerprint,v_version,p_estimated_delivery_days,case when p_provider_quote_reference is null then null else btrim(p_provider_quote_reference) end,v_now,p_expires_at,v_fp) returning * into e; return e;
end $$;

create function public.replace_native_checkout_shipping_quote(
 p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint,p_evidence_id uuid,p_quote_key text
) returns public.checkout_shipping_quotes language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; e public.checkout_shipping_evidence; q public.checkout_shipping_quotes;
begin
 select * into s from public.checkout_sessions where id=p_checkout_id for update;
 if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
 if s.status<>'validating' then raise exception using errcode='23514',message='CHECKOUT_STATE_INVALID'; end if;
 if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
 if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(select 1 from public.carts c where c.id=s.cart_id and c.store_id=s.store_id and c.guest_token_fingerprint=p_guest_fingerprint))) then raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED'; end if;
 select * into e from public.checkout_shipping_evidence where id=p_evidence_id and checkout_session_id=s.id and store_id=s.store_id;
 if not found or e.destination_fingerprint<>s.pii_destination_fingerprint or e.currency<>s.currency or e.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID'; end if;
 delete from public.checkout_shipping_quotes where checkout_session_id=s.id;
 insert into public.checkout_shipping_quotes(checkout_session_id,shipping_evidence_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,estimated_delivery_days,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,provider_quote_reference,is_selected,quoted_at,expires_at,selected_at)
 values(s.id,e.id,p_quote_key,e.shipping_method_id,e.provider,e.external_service_code,e.carrier_name,e.service_name,e.amount_minor,e.currency,e.estimated_delivery_days,e.destination_postcode,e.destination_fingerprint,e.canonical_fingerprint,e.logistics_version,e.provider_quote_reference,true,e.quoted_at,e.expires_at,statement_timestamp()) returning * into q; return q;
end $$;

-- Readiness now requires an exact immutable evidence match. Keep the prior
-- price/PII/reservation implementation and strengthen its selected-quote predicate.
create or replace function public.r1d_shipping_quote_is_authoritative(p_checkout_id uuid,p_store_id uuid,p_currency char(3),p_destination_fingerprint text,p_as_of timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select count(*)=1 from public.checkout_shipping_quotes q join public.checkout_shipping_evidence e on e.id=q.shipping_evidence_id and e.checkout_session_id=q.checkout_session_id
 where q.checkout_session_id=p_checkout_id and e.store_id=p_store_id and q.is_selected and q.expires_at>p_as_of and e.expires_at>p_as_of
 and q.currency=p_currency and e.currency=p_currency and q.destination_fingerprint=p_destination_fingerprint and e.destination_fingerprint=p_destination_fingerprint
 and q.shipping_method_id is not distinct from e.shipping_method_id and q.provider=e.provider and q.external_service_code=e.external_service_code and q.carrier_name=e.carrier_name and q.service_name=e.service_name
 and q.amount_minor=e.amount_minor and q.logistics_version=e.logistics_version and q.quoted_at=e.quoted_at
 and q.logistics_fingerprint=e.canonical_fingerprint and e.canonical_fingerprint=public.canonical_checkout_logistics_fingerprint(e.id,e.checkout_session_id,e.store_id,e.shipping_method_id,e.provider,e.external_service_code,e.carrier_name,e.service_name,e.amount_minor,e.currency,e.destination_postcode,e.destination_fingerprint,e.logistics_inputs_fingerprint,e.logistics_version,e.quoted_at,e.expires_at,e.estimated_delivery_days,e.provider_quote_reference)
$$;

alter table public.checkout_shipping_evidence enable row level security;
revoke all on public.checkout_shipping_evidence from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
revoke all on function public.canonical_checkout_logistics_fingerprint(uuid,uuid,uuid,uuid,public.external_system,text,text,text,bigint,char,text,text,text,text,timestamptz,timestamptz,integer,text), public.r1d_shipping_quote_is_authoritative(uuid,uuid,char,text,timestamptz) from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
revoke all on function public.create_native_shipping_evidence(uuid,uuid,text,bigint,text,uuid,public.external_system,text,text,text,bigint,text,text,text,timestamptz,integer,text), public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,uuid,text) from public,anon,authenticated,persi_worker,persi_readonly;
grant execute on function public.create_native_shipping_evidence(uuid,uuid,text,bigint,text,uuid,public.external_system,text,text,text,bigint,text,text,text,timestamptz,integer,text), public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,uuid,text) to persi_app;

alter function public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) rename to mark_native_checkout_ready_r1d_legacy;
revoke all on function public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text) from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
create function public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)
returns public.checkout_sessions language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions;
begin
 select * into s from public.checkout_sessions where id=$1 for update;
 if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
 if s.shipping_required and not public.r1d_shipping_quote_is_authoritative(s.id,s.store_id,s.currency,s.pii_destination_fingerprint,statement_timestamp()) then
   raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID';
 end if;
 return public.mark_native_checkout_ready_r1d_legacy($1,$2,$3,$4,$5);
end $$;
revoke all on function public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) from public,anon,authenticated,persi_worker,persi_readonly;
grant execute on function public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) to persi_app;
