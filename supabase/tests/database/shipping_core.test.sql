begin;
select plan(30);

select has_table('public', 'shipping_methods', 'shipping methods table exists');
select has_table('public', 'shipments', 'shipments table exists');
select has_table('public', 'shipment_events', 'shipment events table exists');
select has_table('public', 'shipping_provider_credentials', 'shipping credentials table exists');
select has_table('public', 'shipping_quote_cache', 'shipping quote cache table exists');
select has_type('public', 'shipment_status', 'shipment status enum exists');

select col_is_pk('public', 'shipping_methods', 'id', 'shipping method id is primary key');
select col_is_pk('public', 'shipments', 'id', 'shipment id is primary key');
select col_is_pk('public', 'shipment_events', 'id', 'shipment event id is primary key');
select fk_ok('public', 'shipments', array['order_mapping_id', 'order_mapping_entity_type'],
  'public', 'external_mappings', array['id', 'entity_type'], 'shipment references only an order mapping');
select fk_ok('public', 'shipments', 'shipping_method_id', 'public', 'shipping_methods', 'id',
  'shipment shipping method foreign key is valid');
select fk_ok('public', 'shipment_events', 'shipment_id', 'public', 'shipments', 'id',
  'shipment event foreign key is valid');

select ok((select relrowsecurity from pg_class where oid = 'public.shipping_methods'::regclass), 'shipping methods RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shipments'::regclass), 'shipments RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shipment_events'::regclass), 'shipment events RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shipping_provider_credentials'::regclass), 'shipping credentials RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.shipping_quote_cache'::regclass), 'shipping quote cache RLS enabled');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'shipping_provider_credentials'
  and 'persi_readonly' = any(roles)), 0::bigint, 'readonly role has no credentials policy');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename like 'shipping%'
  and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))), 0::bigint,
  'shipping has no browser or public policies');

select has_index('public', 'shipping_methods', 'shipping_methods_provider_code_unique', 'provider service identity is indexed');
select has_index('public', 'shipments', 'shipments_external_unique', 'provider shipment identity is indexed');
select has_index('public', 'shipment_events', 'shipment_events_external_unique', 'provider event identity is indexed');
select has_index('public', 'shipping_provider_credentials', 'shipping_provider_credentials_unique', 'credential scope is indexed');
select has_index('public', 'shipping_quote_cache', 'shipping_quote_cache_key_unique', 'quote cache identity is indexed');
select has_index('public', 'shipping_quote_cache', 'shipping_quote_cache_expires_idx', 'quote expiry is indexed');

select has_column('public', 'shipping_provider_credentials', 'access_token_ciphertext', 'only encrypted access token storage is modeled');
select has_column('public', 'shipping_provider_credentials', 'refresh_token_ciphertext', 'only encrypted refresh token storage is modeled');
select hasnt_column('public', 'shipping_provider_credentials', 'access_token', 'plaintext access token column is absent');
select hasnt_column('public', 'shipping_provider_credentials', 'refresh_token', 'plaintext refresh token column is absent');

set local role anon;
select throws_ok(
  $$insert into public.shipping_methods(provider, external_code, carrier_name, service_name)
    values ('melhor_envio', 'anon-test', 'Carrier', 'Service')$$,
  '42501', null, 'anonymous shipping write is blocked by RLS'
);
reset role;

select * from finish();
rollback;
