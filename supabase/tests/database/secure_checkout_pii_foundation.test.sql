begin;
select plan(22);
select has_column('public','checkout_sessions','pii_ciphertext','ciphertext exists');
select has_column('public','checkout_sessions','pii_destination_fingerprint','destination fingerprint exists');
select has_index('public','checkout_sessions','checkout_sessions_pii_expiry_idx','cleanup index exists');
select has_trigger('public','checkout_sessions','checkout_sessions_pii_lifecycle','lifecycle trigger exists');
select is((select prosecdef from pg_proc where oid='public.persist_checkout_pii(uuid,uuid,text,bigint,text,text,text,integer,text,text,text,timestamptz)'::regprocedure),true,'persist security definer');
select is(has_function_privilege('anon','public.persist_checkout_pii(uuid,uuid,text,bigint,text,text,text,integer,text,text,text,timestamptz)','execute'),false,'anon cannot persist');
select is(has_function_privilege('authenticated','public.read_checkout_pii_envelope(uuid,uuid,text)','execute'),false,'authenticated cannot decrypt');
select is(has_table_privilege('persi_app','public.checkout_sessions','select'),false,'app has no table-wide select');
select is(has_column_privilege('persi_app','public.checkout_sessions','pii_ciphertext','select'),false,'app cannot select ciphertext column');
select is(has_column_privilege('persi_worker','public.checkout_sessions','pii_fingerprint','select'),false,'worker cannot select fingerprint column');

insert into stores(id,code,name,status) values('41000000-0000-4000-8000-000000000001','p3a_store','P3A Store','active');
insert into carts(id,store_id,guest_token_fingerprint,expires_at) values('42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 hour');
insert into checkout_sessions(id,store_id,cart_id,currency,idempotency_key,request_hash,cart_version,expires_at)
values('43000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','BRL','p3a-idempotency-0001',repeat('b',64),0,now()+interval '30 minutes');
insert into shipping_methods(id,provider,external_code,carrier_name,service_name,status)
values('44000000-0000-4000-8000-000000000001','melhor_envio','p3a-service','P3A Carrier','P3A Service','active');
insert into checkout_shipping_quotes(checkout_session_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,is_selected,quoted_at,expires_at,selected_at)
values('43000000-0000-4000-8000-000000000001','p3a-quote','44000000-0000-4000-8000-000000000001','melhor_envio','p3a-service','P3A Carrier','P3A Service',1000,'BRL','13201000',repeat('c',64),repeat('f',64),'v1',true,now(),now()+interval '10 minutes',now());
select throws_ok($$update checkout_sessions set pii_ciphertext=repeat('A',32) where id='43000000-0000-4000-8000-000000000001'$$,'23514',null,'partial envelope rejected');
select lives_ok($$select persist_checkout_pii('43000000-0000-4000-8000-000000000001',null,repeat('a',64),0,repeat('A',32),repeat('B',16),repeat('C',22),1,'test-v1',repeat('d',64),repeat('e',64),now()+interval '20 minutes')$$,'guest persists complete envelope');
select is((select count(*) from checkout_shipping_quotes where checkout_session_id='43000000-0000-4000-8000-000000000001'),0::bigint,'first canonical destination invalidates unbound quote');
select is((select version from checkout_sessions where id='43000000-0000-4000-8000-000000000001'),1::bigint,'version increments');
select throws_ok($$select persist_checkout_pii('43000000-0000-4000-8000-000000000001',null,repeat('a',64),0,repeat('A',32),repeat('B',16),repeat('C',22),1,'test-v1',repeat('d',64),repeat('e',64),now()+interval '20 minutes')$$,'40001','CHECKOUT_VERSION_CONFLICT','stale version rejected');
select throws_ok($$select read_checkout_pii_envelope('43000000-0000-4000-8000-000000000001',null,repeat('f',64))$$,'42501','CHECKOUT_OWNER_DENIED','wrong guest denied');
select is((select count(*) from read_checkout_pii_envelope('43000000-0000-4000-8000-000000000001',null,repeat('a',64))),1::bigint,'owner can read');
set local session_replication_role=replica;
update checkout_sessions set status='ready',version=version+1 where id='43000000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select throws_ok($$update checkout_sessions set pii_fingerprint=repeat('f',64) where id='43000000-0000-4000-8000-000000000001'$$,'23514','CHECKOUT_PII_STATE_INVALID','ready PII immutable');
update checkout_sessions set status='cancelled' where id='43000000-0000-4000-8000-000000000001';
select lives_ok($$select clear_checkout_pii('43000000-0000-4000-8000-000000000001',null,repeat('a',64),(select version from checkout_sessions where id='43000000-0000-4000-8000-000000000001'))$$,'terminal cleanup succeeds');
select is((select num_nonnulls(pii_ciphertext,pii_iv,pii_auth_tag,pii_envelope_version,pii_key_id,pii_fingerprint,pii_destination_fingerprint,pii_expires_at,pii_updated_at) from checkout_sessions where id='43000000-0000-4000-8000-000000000001'),0,'cleanup clears all sensitive metadata');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='checkout_sessions' and column_name in ('first_name','last_name','email','phone','street','number','tax_document')),0::bigint,'no plaintext PII columns');
select is((select count(*) from pg_policies where schemaname='public' and tablename='checkout_sessions' and ('public'=any(roles) or 'anon'=any(roles) or 'authenticated'=any(roles))),0::bigint,'zero browser policies');
select * from finish();
rollback;
