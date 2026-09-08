begin;
select plan(56);

select has_table('public', 'stores', 'stores table exists');
select has_table('public', 'customers', 'customers table exists');
select has_table('public', 'customer_identities', 'customer identities table exists');
select has_table('public', 'customer_addresses', 'customer addresses table exists');
select has_type('public', 'customer_status', 'customer status enum exists');
select has_type('public', 'customer_type', 'customer type enum exists');

select col_is_pk('public', 'stores', 'id', 'store id is primary key');
select col_is_pk('public', 'customers', 'id', 'customer id is primary key');
select col_is_pk('public', 'customer_identities', 'id', 'identity id is primary key');
select col_is_pk('public', 'customer_addresses', 'id', 'address id is primary key');
select fk_ok('public', 'customer_identities', 'customer_id', 'public', 'customers', 'id', 'identity belongs to customer');
select fk_ok('public', 'customer_addresses', 'customer_id', 'public', 'customers', 'id', 'address belongs to customer');

select has_index('public', 'stores', 'stores_code_unique', 'store code uniqueness is indexed');
select has_index('public', 'customer_identities', 'customer_identities_issuer_subject_unique', 'auth identity uniqueness is indexed');
select has_index('public', 'customer_identities', 'customer_identities_customer_idx', 'customer identity lookup is indexed');
select has_index('public', 'customers', 'customers_email_normalized_idx', 'normalized email lookup is indexed');
select has_index('public', 'customers', 'customers_phone_normalized_idx', 'normalized phone lookup is indexed');
select has_index('public', 'customers', 'customers_tax_id_fingerprint_idx', 'document fingerprint lookup is indexed');
select has_index('public', 'customer_addresses', 'customer_addresses_customer_status_idx', 'customer address lookup is indexed');

select ok((select relrowsecurity from pg_class where oid = 'public.stores'::regclass), 'stores RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.customers'::regclass), 'customers RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.customer_identities'::regclass), 'identities RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.customer_addresses'::regclass), 'addresses RLS enabled');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename in
  ('stores','customers','customer_identities','customer_addresses') and
  ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))), 0::bigint,
  'no public, anon or authenticated policies exist');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename in
  ('customers','customer_identities','customer_addresses') and 'persi_readonly' = any(roles)), 0::bigint,
  'readonly role has no PII policies');
select is(has_table_privilege('anon', 'public.stores', 'SELECT'), false, 'anon has no store SELECT grant');
select is(has_table_privilege('authenticated', 'public.stores', 'SELECT'), false, 'authenticated has no store SELECT grant');
select is(has_table_privilege('anon', 'public.customers', 'SELECT'), false, 'anon has no customer SELECT grant');
select is(has_table_privilege('authenticated', 'public.customers', 'INSERT'), false, 'authenticated has no customer INSERT grant');

select lives_ok($$insert into public.customers(id) values ('10000000-0000-4000-8000-000000000001')$$,
  'customer without auth identity is allowed');
select lives_ok($$insert into public.stores(id,code,name) values
  ('20000000-0000-4000-8000-000000000001','store_a','Synthetic A'),
  ('20000000-0000-4000-8000-000000000002','store_b','Synthetic B')$$,
  'two synthetic stores coexist without collision');
select hasnt_column('public', 'customers', 'store_id', 'customer profile is global across stores');
select lives_ok($$insert into public.customers(id,email) values
  ('10000000-0000-4000-8000-000000000002',null)$$, 'customer email may be null');
select lives_ok($$insert into public.customers(id,email) values
  ('10000000-0000-4000-8000-000000000003','shared@example.invalid'),
  ('10000000-0000-4000-8000-000000000004','SHARED@example.invalid')$$,
  'email is searchable but deliberately not a unique identity');
select lives_ok($$insert into public.customer_identities(customer_id,issuer,subject) values
  ('10000000-0000-4000-8000-000000000001','wordpress','synthetic-subject-a'),
  ('10000000-0000-4000-8000-000000000001','future_auth','synthetic-subject-b')$$,
  'one customer can have multiple auth identities');
select throws_ok($$insert into public.customer_identities(customer_id,issuer,subject) values
  ('10000000-0000-4000-8000-000000000002','wordpress','synthetic-subject-a')$$,
  '23505', null, 'one auth identity cannot belong to two customers');
select lives_ok($$insert into public.customer_addresses(customer_id,recipient,street,number,neighborhood,postal_code,city,state) values
  ('10000000-0000-4000-8000-000000000001','Pessoa A','Rua A','1','Centro','01001000','Cidade A','SP'),
  ('10000000-0000-4000-8000-000000000001','Pessoa A','Rua B','2','Centro','01001000','Cidade A','SP')$$,
  'customer can have multiple addresses sharing a CEP');
select throws_ok($$insert into public.customer_identities(customer_id,issuer,subject) values
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','wordpress','orphan')$$,
  '23503', null, 'orphan identity is rejected');
select throws_ok($$insert into public.customer_addresses(customer_id,recipient,street,number,neighborhood,postal_code,city,state) values
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','Pessoa','Rua','1','Centro','01001000','Cidade','SP')$$,
  '23503', null, 'orphan address is rejected');
select throws_ok($$insert into public.stores(code,name) values ('store_a','Duplicate')$$,
  '23505', null, 'duplicate store code is rejected');
select throws_ok($$insert into public.stores(code,name) values ('','Invalid')$$,
  '23514', null, 'invalid empty store identity is rejected');
select throws_ok($$insert into public.customers(tax_id_type,tax_id_ciphertext,tax_id_fingerprint) values
  ('cpf',repeat('x',32),'not-a-fingerprint')$$,
  '23514', null, 'invalid document fingerprint is rejected');
select throws_ok($$insert into public.customers(tax_id_type) values ('cpf')$$,
  '23514', null, 'partial document security bundle is rejected');
select throws_ok($$insert into public.customer_addresses(customer_id,recipient,street,number,neighborhood,postal_code,city,state) values
  ('10000000-0000-4000-8000-000000000001','Pessoa','Rua','1','Centro','123','Cidade','SP')$$,
  '23514', null, 'invalid Brazilian CEP is rejected');
select throws_ok($$insert into public.customer_addresses(customer_id,recipient,street,number,neighborhood,postal_code,city,state,country) values
  ('10000000-0000-4000-8000-000000000001','Pessoa','Rua','1','Centro','01001000','Cidade','SP','br')$$,
  '23514', null, 'country normalization requires uppercase ISO code');
select throws_ok($$delete from public.customers where id='10000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'identity prevents customer cascade deletion');
select throws_ok($$delete from public.customers where id='10000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'address and identity preserve customer ownership');
select hasnt_column('public', 'customer_identities', 'password', 'identity stores no password');
select hasnt_column('public', 'customer_identities', 'access_token', 'identity stores no access token');
select hasnt_column('public', 'customers', 'tax_id', 'customer stores no plaintext tax id');

set local role anon;
select throws_ok($$select * from public.customers$$, '42501', null, 'anonymous customer SELECT is blocked');
select throws_ok($$insert into public.customers default values$$, '42501', null, 'anonymous customer INSERT is blocked');
select throws_ok($$select * from public.customer_identities$$, '42501', null, 'anonymous identity SELECT is blocked');
select throws_ok($$insert into public.customer_identities(customer_id,issuer,subject) values
  ('10000000-0000-4000-8000-000000000001','anon','blocked')$$,
  '42501', null, 'anonymous identity INSERT is blocked');
select throws_ok($$select * from public.customer_addresses$$, '42501', null, 'anonymous address SELECT is blocked');
select throws_ok($$insert into public.customer_addresses(customer_id,recipient,street,number,neighborhood,postal_code,city,state) values
  ('10000000-0000-4000-8000-000000000001','Pessoa','Rua','1','Centro','01001000','Cidade','SP')$$,
  '42501', null, 'anonymous address INSERT is blocked');
reset role;

select * from finish();
rollback;
