\set ON_ERROR_STOP on
begin;
\i /tmp/20260905130000_checkout_shipping_authority.sql

do $$
declare base text; candidate text; store_id uuid:=gen_random_uuid(); checkout_id uuid:=gen_random_uuid(); evidence_id uuid:=gen_random_uuid(); quoted timestamptz:='2026-09-05 12:00:00.123456+00'; expires timestamptz:='2026-09-05 13:00:00.123456+00';
begin
 base:=canonical_checkout_logistics_fingerprint(evidence_id,checkout_id,store_id,gen_random_uuid(),'melhor_envio','svc','carrier','service',1500,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,3,'ref');
 if base is null then raise exception 'OPTIONAL_POPULATED_NULL'; end if;
 if canonical_checkout_logistics_fingerprint(evidence_id,checkout_id,store_id,null,'melhor_envio','svc','carrier','service',1500,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,null,null) is null then raise exception 'OPTIONAL_NULL_MATRIX_FAILED'; end if;
 if canonical_checkout_logistics_fingerprint(evidence_id,checkout_id,store_id,null,'melhor_envio','svc','carrier','service',1500,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,null,null) <> canonical_checkout_logistics_fingerprint(evidence_id,checkout_id,store_id,null,'melhor_envio','svc','carrier','service',1500,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,null,null) then raise exception 'FINGERPRINT_NONDETERMINISTIC'; end if;
 candidate:=canonical_checkout_logistics_fingerprint(evidence_id,checkout_id,store_id,null,'melhor_envio','svc','carrier','service',1501,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,null,null);
 if candidate=canonical_checkout_logistics_fingerprint(evidence_id,checkout_id,store_id,null,'melhor_envio','svc','carrier','service',1500,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,null,null) then raise exception 'AMOUNT_NOT_BOUND'; end if;
 begin
  perform canonical_checkout_logistics_fingerprint(null,checkout_id,store_id,null,'melhor_envio','svc','carrier','service',1500,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',quoted,expires,null,null);
  raise exception 'MANDATORY_NULL_ACCEPTED';
 exception when sqlstate '22023' then null; end;
end $$;

insert into stores(id,code,name,status) values('71000000-0000-4000-8000-000000000001','r2c-store','R2C','active');
insert into carts(id,store_id,guest_token_fingerprint,status,currency,expires_at) values('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',repeat('a',64),'locked','BRL',now()+interval '1 hour');
insert into checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,shipping_required,expires_at,pii_ciphertext,pii_iv,pii_auth_tag,pii_envelope_version,pii_key_id,pii_fingerprint,pii_destination_fingerprint,pii_expires_at,pii_updated_at)
values('71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','validating','BRL','r2c-checkout-idempotency',repeat('b',64),0,true,now()+interval '1 hour',repeat('A',32),repeat('B',16),repeat('C',22),1,'r2c-v1',repeat('d',64),repeat('e',64),now()+interval '30 minutes',now());

select id,canonical_fingerprint is not null as fingerprint_present from create_native_shipping_evidence('71000000-0000-4000-8000-000000000003',null,repeat('a',64),0,'r2c-evidence-idempotency',null,'melhor_envio','SVC','Carrier','Service',1500,'13201000',repeat('e',64),repeat('f',64),now()+interval '20 minutes',null,null);
select count(*)=1 as idempotent from create_native_shipping_evidence('71000000-0000-4000-8000-000000000003',null,repeat('a',64),0,'r2c-evidence-idempotency',null,'melhor_envio','svc','carrier','service',1500,'13201000',repeat('e',64),repeat('f',64),(select expires_at from checkout_shipping_evidence limit 1),null,null);

do $$ begin
 begin
  perform create_native_shipping_evidence('71000000-0000-4000-8000-000000000003',null,repeat('a',64),0,'r2c-evidence-idempotency',null,'melhor_envio','svc','carrier','service',1500,'13201000',repeat('e',64),repeat('f',64),(select expires_at from checkout_shipping_evidence limit 1),null,'different');
  raise exception 'IDEMPOTENCY_CONFLICT_NOT_RAISED';
 exception when unique_violation then if sqlerrm<>'SHIPPING_EVIDENCE_IDEMPOTENCY_CONFLICT' then raise; end if; end;
 begin
  update checkout_shipping_evidence set amount_minor=1501;
  raise exception 'IMMUTABILITY_NOT_ENFORCED';
 exception when check_violation then if sqlerrm<>'CHECKOUT_SHIPPING_EVIDENCE_IMMUTABLE' then raise; end if; end;
end $$;

select to_regclass('public.checkout_shipping_evidence') is not null as evidence_table,
       (select relrowsecurity from pg_class where oid='public.checkout_shipping_evidence'::regclass) as rls,
       not has_table_privilege('anon','public.checkout_shipping_evidence','insert') as anon_insert_denied,
       not has_function_privilege('anon','public.create_native_shipping_evidence(uuid,uuid,text,bigint,text,uuid,external_system,text,text,text,bigint,text,text,text,timestamptz,integer,text)','execute') as anon_execute_denied,
       exists(select 1 from pg_trigger where tgname='checkout_shipping_evidence_immutable') as immutable_trigger;

rollback;
