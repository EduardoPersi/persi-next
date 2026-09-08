-- B.3-C3-P3-A secure temporary checkout PII foundation. Local/dark; no C3 runtime.
alter table public.checkout_sessions
  add column pii_ciphertext text,
  add column pii_iv text,
  add column pii_auth_tag text,
  add column pii_envelope_version integer,
  add column pii_key_id text,
  add column pii_fingerprint text,
  add column pii_destination_fingerprint text,
  add column pii_expires_at timestamptz,
  add column pii_updated_at timestamptz,
  add constraint checkout_sessions_pii_complete check (
    num_nonnulls(pii_ciphertext,pii_iv,pii_auth_tag,pii_envelope_version,pii_key_id,
      pii_fingerprint,pii_destination_fingerprint,pii_expires_at,pii_updated_at) in (0,9)
  ),
  add constraint checkout_sessions_pii_ciphertext_format check (
    pii_ciphertext is null or (length(pii_ciphertext) between 16 and 65536 and pii_ciphertext ~ '^[A-Za-z0-9_-]+$')
  ),
  add constraint checkout_sessions_pii_iv_format check (pii_iv is null or pii_iv ~ '^[A-Za-z0-9_-]{16}$'),
  add constraint checkout_sessions_pii_tag_format check (pii_auth_tag is null or pii_auth_tag ~ '^[A-Za-z0-9_-]{22}$'),
  add constraint checkout_sessions_pii_version_check check (pii_envelope_version is null or pii_envelope_version>0),
  add constraint checkout_sessions_pii_key_id_format check (pii_key_id is null or pii_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'),
  add constraint checkout_sessions_pii_fingerprint_format check (pii_fingerprint is null or pii_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint checkout_sessions_pii_destination_format check (pii_destination_fingerprint is null or pii_destination_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint checkout_sessions_pii_expiry_check check (pii_expires_at is null or pii_expires_at<=expires_at);

create index checkout_sessions_pii_expiry_idx on public.checkout_sessions(pii_expires_at,id)
  where pii_ciphertext is not null;

create function public.enforce_checkout_pii_lifecycle()
returns trigger language plpgsql security invoker set search_path='' as $$
declare changed boolean;
begin
  changed := row(new.pii_ciphertext,new.pii_iv,new.pii_auth_tag,new.pii_envelope_version,
    new.pii_key_id,new.pii_fingerprint,new.pii_destination_fingerprint,new.pii_expires_at,new.pii_updated_at)
    is distinct from
    row(old.pii_ciphertext,old.pii_iv,old.pii_auth_tag,old.pii_envelope_version,
      old.pii_key_id,old.pii_fingerprint,old.pii_destination_fingerprint,old.pii_expires_at,old.pii_updated_at);
  if not changed then return new; end if;
  if new.pii_ciphertext is not null then
    if old.status not in ('open','validating') or new.status not in ('open','validating') then
      raise exception using errcode='23514',message='CHECKOUT_PII_STATE_INVALID';
    end if;
    if new.pii_expires_at<=statement_timestamp() or new.pii_expires_at>statement_timestamp()+interval '24 hours' then
      raise exception using errcode='23514',message='CHECKOUT_PII_EXPIRY_INVALID';
    end if;
  elsif old.pii_ciphertext is not null and old.status not in ('submitting','order_created','expired','cancelled') then
    raise exception using errcode='23514',message='CHECKOUT_PII_CLEANUP_STATE_INVALID';
  end if;
  return new;
end $$;

create trigger checkout_sessions_pii_lifecycle
before update of pii_ciphertext,pii_iv,pii_auth_tag,pii_envelope_version,pii_key_id,
  pii_fingerprint,pii_destination_fingerprint,pii_expires_at,pii_updated_at
on public.checkout_sessions for each row execute function public.enforce_checkout_pii_lifecycle();

create function public.persist_checkout_pii(
  p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint,
  p_ciphertext text,p_iv text,p_auth_tag text,p_envelope_version integer,p_key_id text,
  p_fingerprint text,p_destination_fingerprint text,p_expires_at timestamptz
) returns table(checkout_id uuid,checkout_version bigint,pii_fingerprint text,destination_fingerprint text,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions;
begin
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  if s.status not in ('open','validating') then raise exception using errcode='23514',message='CHECKOUT_STATE_INVALID'; end if;
  if s.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CHECKOUT_EXPIRED'; end if;
  if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
     (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(
       select 1 from public.carts c where c.id=s.cart_id and c.store_id=s.store_id and
         c.guest_token_fingerprint=p_guest_fingerprint))) then
    raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED';
  end if;
  if p_expires_at>least(s.expires_at,statement_timestamp()+interval '24 hours') or p_expires_at<=statement_timestamp() then
    raise exception using errcode='22023',message='CHECKOUT_PII_EXPIRY_INVALID';
  end if;
  if s.pii_destination_fingerprint is null or s.pii_destination_fingerprint<>p_destination_fingerprint then
    delete from public.checkout_shipping_quotes q where q.checkout_session_id=s.id;
  end if;
  update public.checkout_sessions set
    pii_ciphertext=p_ciphertext,pii_iv=p_iv,pii_auth_tag=p_auth_tag,
    pii_envelope_version=p_envelope_version,pii_key_id=p_key_id,
    pii_fingerprint=p_fingerprint,pii_destination_fingerprint=p_destination_fingerprint,
    pii_expires_at=p_expires_at,pii_updated_at=statement_timestamp(),version=version+1
  where id=s.id returning * into s;
  return query select s.id,s.version,s.pii_fingerprint,s.pii_destination_fingerprint,s.pii_expires_at;
end $$;

create function public.read_checkout_pii_envelope(
  p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text
) returns table(checkout_id uuid,store_id uuid,checkout_version bigint,pii_ciphertext text,
  pii_iv text,pii_auth_tag text,pii_envelope_version integer,pii_key_id text,
  pii_fingerprint text,pii_destination_fingerprint text,pii_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions;
begin
  select * into s from public.checkout_sessions where id=p_checkout_id;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
     (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(
       select 1 from public.carts c where c.id=s.cart_id and c.store_id=s.store_id and
         c.guest_token_fingerprint=p_guest_fingerprint))) then
    raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED';
  end if;
  if s.pii_ciphertext is null then raise exception using errcode='P0002',message='CHECKOUT_PII_REQUIRED'; end if;
  return query select s.id,s.store_id,s.version,s.pii_ciphertext,s.pii_iv,s.pii_auth_tag,
    s.pii_envelope_version,s.pii_key_id,s.pii_fingerprint,s.pii_destination_fingerprint,s.pii_expires_at;
end $$;

create function public.clear_checkout_pii(
  p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint
) returns table(checkout_id uuid,checkout_version bigint,cleared boolean)
language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions;
begin
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  if s.status not in ('submitting','order_created','expired','cancelled') then
    raise exception using errcode='23514',message='CHECKOUT_PII_CLEANUP_STATE_INVALID';
  end if;
  if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
     (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(
       select 1 from public.carts c where c.id=s.cart_id and c.store_id=s.store_id and
         c.guest_token_fingerprint=p_guest_fingerprint))) then
    raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED';
  end if;
  update public.checkout_sessions set pii_ciphertext=null,pii_iv=null,pii_auth_tag=null,
    pii_envelope_version=null,pii_key_id=null,pii_fingerprint=null,
    pii_destination_fingerprint=null,pii_expires_at=null,pii_updated_at=null,version=version+1
  where id=s.id returning * into s;
  return query select s.id,s.version,true;
end $$;

revoke all on function public.enforce_checkout_pii_lifecycle(),
  public.persist_checkout_pii(uuid,uuid,text,bigint,text,text,text,integer,text,text,text,timestamptz),
  public.read_checkout_pii_envelope(uuid,uuid,text),
  public.clear_checkout_pii(uuid,uuid,text,bigint) from public,anon,authenticated;

-- App/worker read only explicit non-PII checkout columns. Raw crypto material is
-- available solely through the ownership-checking server function.
revoke select on public.checkout_sessions from persi_app,persi_worker;
grant select(id,store_id,cart_id,customer_id,status,currency,idempotency_key,request_hash,
  cart_version,correlation_id,shipping_required,expires_at,version,created_at,updated_at,
  store_price_list_assignment_id,store_price_list_assignment_version,price_list_id)
on public.checkout_sessions to persi_app,persi_worker;
grant execute on function public.persist_checkout_pii(uuid,uuid,text,bigint,text,text,text,integer,text,text,text,timestamptz),
  public.read_checkout_pii_envelope(uuid,uuid,text),
  public.clear_checkout_pii(uuid,uuid,text,bigint) to persi_app;

comment on column public.checkout_sessions.pii_ciphertext is 'Temporary AES-256-GCM checkout contact/address envelope; never plaintext.';
comment on function public.persist_checkout_pii(uuid,uuid,text,bigint,text,text,text,integer,text,text,text,timestamptz) is 'Server-only owner-checked PII persistence with optimistic version and quote invalidation.';
