begin;
select no_plan();

select has_type('public','commercial_context','commercial context enum exists');
select has_table('public','store_price_list_assignments','authority table exists');
select col_is_pk('public','store_price_list_assignments','id','assignment PK');
select col_type_is('public','store_price_list_assignments','version','bigint','version is bigint');
select col_type_is('public','store_price_list_assignments','currency','character(3)','currency is ISO char(3)');
select has_column('public','checkout_sessions','store_price_list_assignment_id','checkout snapshots assignment');
select has_column('public','checkout_sessions','store_price_list_assignment_version','checkout snapshots version');
select has_column('public','checkout_sessions','price_list_id','checkout snapshots list');
select has_index('public','store_price_list_assignments','store_price_assignments_lookup_idx','authority lookup indexed');
select has_index('public','store_price_list_assignments','store_price_assignments_version_unique','versions unique');
select has_index('public','checkout_sessions','checkout_sessions_authority_idx','checkout authority indexed');
select ok((select relrowsecurity from pg_class where oid='public.store_price_list_assignments'::regclass),'assignment RLS');
select is((select count(*) from pg_policies where schemaname='public' and tablename='store_price_list_assignments'),0::bigint,'zero policies');
select is(has_table_privilege('anon','public.store_price_list_assignments','select'),false,'anon blocked');
select is(has_table_privilege('authenticated','public.store_price_list_assignments','select'),false,'authenticated blocked');
select is(has_table_privilege('persi_app','public.store_price_list_assignments','insert'),false,'app cannot configure');
select is(has_table_privilege('persi_worker','public.store_price_list_assignments','update'),false,'worker cannot configure');
select is(has_table_privilege('persi_readonly','public.store_price_list_assignments','select'),false,'readonly blocked');
select is(has_table_privilege('persi_app','public.store_price_list_assignments','delete'),false,'app cannot delete');
select is(has_function_privilege('anon','public.resolve_store_price_authority(uuid,character,commercial_context,timestamp with time zone)','execute'),false,'anon cannot resolve');
select is(has_function_privilege('authenticated','public.resolve_store_price_authority(uuid,character,commercial_context,timestamp with time zone)','execute'),false,'authenticated cannot resolve');
select is(has_function_privilege('persi_app','public.resolve_store_price_authority(uuid,character,commercial_context,timestamp with time zone)','execute'),true,'app resolves server-side');

insert into stores(id,code,name,status,default_currency) values
 ('71000000-0000-4000-8000-000000000001','p1_store_a','P1 Store A','active','BRL'),
 ('71000000-0000-4000-8000-000000000002','p1_store_b','P1 Store B','active','BRL'),
 ('71000000-0000-4000-8000-000000000003','p1_store_missing','P1 Missing','active','BRL');
insert into price_lists(id,code,name,currency,channel,status) values
 ('72000000-0000-4000-8000-000000000001','p1_list_a','P1 List A','BRL','storefront','active'),
 ('72000000-0000-4000-8000-000000000002','p1_list_b','P1 List B','BRL','storefront','active'),
 ('72000000-0000-4000-8000-000000000003','p1_list_inactive','P1 Inactive','BRL','storefront','inactive'),
 ('72000000-0000-4000-8000-000000000004','p1_list_usd','P1 USD','USD','storefront','active');

insert into store_price_list_assignments(id,store_id,price_list_id,currency,commercial_context,version,valid_from,valid_to) values
 ('73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','BRL','storefront_retail',1,'2026-01-01','2026-06-01'),
 ('73000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','BRL','storefront_retail',2,'2026-06-01',null),
 ('73000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','BRL','storefront_retail',1,'2026-01-01',null);

select is((select price_list_id from resolve_store_price_authority('71000000-0000-4000-8000-000000000001','BRL','storefront_retail','2026-08-01')),'72000000-0000-4000-8000-000000000001'::uuid,'store A resolves list A');
select is((select assignment_version from resolve_store_price_authority('71000000-0000-4000-8000-000000000001','BRL','storefront_retail','2026-06-01')),2::bigint,'adjacent boundary resolves new version');
select is((select price_list_id from resolve_store_price_authority('71000000-0000-4000-8000-000000000002','BRL','storefront_retail','2026-08-01')),'72000000-0000-4000-8000-000000000002'::uuid,'store B resolves list B');
insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values
 ('71000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000004','USD','storefront_retail',1,'2026-01-01');
select is((select price_list_id from resolve_store_price_authority('71000000-0000-4000-8000-000000000002','USD','storefront_retail','2026-08-01')),'72000000-0000-4000-8000-000000000004'::uuid,'currency scopes resolve independently');
select throws_ok($$select * from resolve_store_price_authority('71000000-0000-4000-8000-000000000003','BRL','storefront_retail','2026-08-01')$$,'P0002','STORE_PRICE_CONFIG_MISSING','missing fails closed');
select throws_ok($$insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','BRL','storefront_retail',3,'2026-07-01')$$,'23P01','STORE_PRICE_CONFIG_OVERLAP','overlap rejected');
select throws_ok($$insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values('71000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000004','BRL','storefront_retail',1,'2027-01-01')$$,'23503',null,'currency mismatch rejected by FK');
select throws_ok($$insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','BRL','storefront_retail',2,'2027-01-01')$$,'23514','STORE_PRICE_CONFIG_VERSION_NOT_MONOTONIC','version reuse rejected');
select throws_ok($$delete from store_price_list_assignments where id='73000000-0000-4000-8000-000000000001'$$,'23514','STORE_PRICE_CONFIG_DELETE_FORBIDDEN','history cannot be deleted');

insert into store_price_list_assignments(id,store_id,price_list_id,currency,commercial_context,version,valid_from) values
 ('73000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000003','BRL','storefront_retail',1,'2026-01-01');
select throws_ok($$select * from resolve_store_price_authority('71000000-0000-4000-8000-000000000003','BRL','storefront_retail','2026-08-01')$$,'23514','PRICE_LIST_INACTIVE','inactive list fails closed');

insert into carts(id,store_id,guest_token_fingerprint,expires_at) values
 ('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',repeat('7',64),now()+interval '1 hour'),
 ('74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003',repeat('8',64),now()+interval '1 hour'),
 ('74000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001',repeat('9',64),now()+interval '1 hour'),
 ('74000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 hour');
select throws_ok($$insert into checkout_sessions(store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at)
 values('71000000-0000-4000-8000-000000000003','74000000-0000-4000-8000-000000000002','ready','BRL','p1-ready-missing-0001',repeat('1',64),0,now()+interval '1 hour')$$,
 '23514','CHECKOUT_PRICE_AUTHORITY_REQUIRED','ready requires authority snapshot');
select lives_ok($$insert into checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at,store_price_list_assignment_id,store_price_list_assignment_version,price_list_id)
 values('75000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','ready','BRL','p1-ready-valid-000001',repeat('2',64),0,now()+interval '1 hour','73000000-0000-4000-8000-000000000002',2,'72000000-0000-4000-8000-000000000001')$$,
 'ready accepts a complete current authority snapshot');
select throws_ok($$update checkout_sessions set store_price_list_assignment_version=1 where id='75000000-0000-4000-8000-000000000001'$$,
 '23514','CHECKOUT_PRICE_AUTHORITY_IMMUTABLE','ready authority is immutable');
select throws_ok($$insert into checkout_sessions(store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at,store_price_list_assignment_id,store_price_list_assignment_version,price_list_id)
 values('71000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000003','open','BRL','p1-version-bad-000001',repeat('3',64),0,now()+interval '1 hour','73000000-0000-4000-8000-000000000002',999,'72000000-0000-4000-8000-000000000001')$$,
 '23503',null,'snapshot version mismatch rejected');
select throws_ok($$insert into checkout_sessions(store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at,store_price_list_assignment_id,store_price_list_assignment_version,price_list_id)
 values('71000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000004','open','BRL','p1-list-bad-00000001',repeat('4',64),0,now()+interval '1 hour','73000000-0000-4000-8000-000000000002',2,'72000000-0000-4000-8000-000000000002')$$,
 '23503',null,'snapshot price list mismatch rejected');

select * from finish();
rollback;
