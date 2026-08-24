begin;
create extension if not exists pgtap with schema extensions;
alter extension pgtap set schema public;
insert into public.units (code, symbol, name, dimension) values
  ('mm', 'mm', 'milímetro', 'length'),
  ('in', '"', 'polegada', 'length')
on conflict (code) do nothing;
select plan(37);

select has_extension('unaccent', 'unaccent extension enabled');
select has_extension('pg_trgm', 'pg_trgm extension enabled');
select has_table('public', 'products', 'products exists');
select has_table('public', 'product_variants', 'product_variants exists');
select has_table('public', 'measurement_components', 'measurement_components exists');
select has_table('public', 'inventory_levels', 'inventory_levels exists');
select has_table('public', 'external_mappings', 'external_mappings exists');
select has_table('public', 'integration_inbox', 'integration inbox exists');
select has_table('public', 'integration_checkpoints', 'integration checkpoints exist');
select has_table('public', 'catalog_search_documents', 'catalog search read model exists');
select has_table('public', 'product_tags', 'structured product tags exist');
select has_table('public', 'product_tag_assignments', 'product tag assignments exist');

insert into public.brands (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Marca Teste', 'marca-teste');
select throws_ok(
  $$insert into public.brands (name, slug) values ('Outra', 'marca-teste')$$,
  '23505', null, 'brand slug is unique'
);

insert into public.categories (id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', 'Hidráulica', 'hidraulica');
insert into public.categories (id, parent_id, name, slug) values
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Conexões', 'conexoes');
select is(
  (select parent_id from public.categories where id = '20000000-0000-0000-0000-000000000002'),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'category adjacency relationship works'
);
select throws_ok(
  $$update public.categories set parent_id = id where id = '20000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'category cannot parent itself'
);

insert into public.products (id, brand_id, primary_category_id, name, slug) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002', 'Adaptador Teste', 'adaptador-teste');
select ok(exists(select 1 from public.products where slug = 'adaptador-teste'), 'product can be created');
select ok(
  (select is_purchasable = false and allows_backorder = false and average_rating = 0
   from public.products where id = '30000000-0000-0000-0000-000000000001'),
  'commercial flags have safe defaults'
);

insert into public.product_variants (id, product_id, sku, gtin) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', ' sku-001 ', null),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'SKU-002', '7891234567890');
select is((select sku_normalized from public.product_variants where id = '40000000-0000-0000-0000-000000000001'), 'SKU-001', 'SKU is normalized');
select is((select count(*) from public.product_variants where gtin is null), 1::bigint, 'GTIN may be null');
select throws_ok(
  $$insert into public.product_variants (product_id, sku, gtin) values
    ('30000000-0000-0000-0000-000000000001', 'SKU-003', '7891234567890')$$,
  '23505', null, 'non-null GTIN is unique'
);
select throws_ok(
  $$insert into public.product_variants (product_id, sku) values
    ('30000000-0000-0000-0000-000000000001', 'SKU-001')$$,
  '23505', null, 'normalized SKU is unique'
);

select is((select count(*) from public.units where code in ('mm', 'in')), 2::bigint, 'structural units are seeded');
insert into public.attributes (
  id, code, name, data_type, unit_dimension, is_commercial, is_technical, is_variation, is_filterable, is_searchable
) values (
  '50000000-0000-0000-0000-000000000001', 'connection_measure', 'Medida da conexão',
  'composite_measurement', 'length', true, true, true, true, true
);
select is((select data_type::text from public.attributes where code = 'connection_measure'), 'composite_measurement', 'attribute type is controlled');

insert into public.attribute_values (id, attribute_id, display_value, normalized_text) values (
  '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
  '16mm x 1/2"', '16 mm x 1/2 in'
);
insert into public.measurement_components (
  attribute_value_id, position, semantic_role, numerator, denominator, unit_id, display_value
) values
  ('60000000-0000-0000-0000-000000000001', 1, 'diameter_a', 16, 1, (select id from public.units where code = 'mm'), '16mm'),
  ('60000000-0000-0000-0000-000000000001', 2, 'thread_b', 1, 2, (select id from public.units where code = 'in'), '1/2"');
select is((select display_value from public.attribute_values where id = '60000000-0000-0000-0000-000000000001'), '16mm x 1/2"', 'composite display remains one commercial value');
select is((select count(*) from public.measurement_components where attribute_value_id = '60000000-0000-0000-0000-000000000001'), 2::bigint, 'composite components are queryable separately');
select is((select denominator from public.measurement_components where semantic_role = 'thread_b'), 2::bigint, 'imperial fraction is exact');
select is((select count(*) from public.attributes where id = '50000000-0000-0000-0000-000000000001'), 1::bigint, 'composite does not create extra commercial attributes');

insert into public.price_lists (id, code, name, currency, status) values
  ('70000000-0000-0000-0000-000000000001', 'test-brl', 'Teste BRL', 'BRL', 'active');
insert into public.prices (id, product_variant_id, price_list_id, list_amount_minor, currency) values
  ('71000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001', 1990, 'BRL');
select is((select list_amount_minor from public.prices where id = '71000000-0000-0000-0000-000000000001'), 1990::bigint, 'money uses bigint minor units');
select throws_ok(
  $$insert into public.prices (product_variant_id, price_list_id, list_amount_minor, currency, valid_from)
    values ('40000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', -1, 'BRL', now())$$,
  '23514', null, 'negative price is rejected'
);
select throws_ok(
  $$insert into public.prices (product_variant_id, price_list_id, list_amount_minor, currency, valid_from)
    values ('40000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 2000, 'USD', now() + interval '1 day')$$,
  '23514', 'price_currency_differs_from_price_list', 'price currency must match list'
);

insert into public.inventory_locations (id, code, name, status) values
  ('80000000-0000-0000-0000-000000000001', 'test-location', 'Local Teste', 'active');
insert into public.inventory_levels (id, product_variant_id, inventory_location_id, quantity_on_hand) values
  ('81000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 2);
select throws_ok(
  $$insert into public.inventory_levels (product_variant_id, inventory_location_id)
    values ('40000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'inventory level is unique per variant and location'
);
select lives_ok(
  $$select public.reserve_inventory('81000000-0000-0000-0000-000000000001', 1, 'test', 'one', 'reserve-one', now() + interval '5 minutes')$$,
  'inventory can be reserved'
);
select is((select quantity_available from public.inventory_levels where id = '81000000-0000-0000-0000-000000000001'), 1::bigint, 'available inventory is derived');
select is((select count(*) from public.inventory_movements where source_reference = 'reserve-one'), 1::bigint, 'reservation writes ledger movement');

insert into public.external_mappings (system, entity_type, internal_id, external_id)
values ('woocommerce', 'product', '30000000-0000-0000-0000-000000000001', '123');
select throws_ok(
  $$insert into public.external_mappings (system, entity_type, internal_id, external_id)
    values ('woocommerce', 'product', gen_random_uuid(), '123')$$,
  '23505', null, 'external identity is unique by system type and id'
);

insert into public.integration_inbox(source,event_type,external_event_id,entity_type,external_entity_id)
values ('woocommerce','product.updated','event-123','product','123');
select throws_ok(
  $$insert into public.integration_inbox(source,event_type,external_event_id,entity_type,external_entity_id)
    values ('woocommerce','product.updated','event-123','product','123')$$,
  '23505', null, 'inbox deduplicates source event id'
);
update public.products set status='active',published_at=now() where id='30000000-0000-0000-0000-000000000001';
update public.product_variants set status='active' where product_id='30000000-0000-0000-0000-000000000001';
select public.refresh_catalog_search_document('30000000-0000-0000-0000-000000000001');
select is((select count(*) from public.catalog_search('Adaptador Teste',20)), 1::bigint, 'catalog search finds exact product name');

select * from finish();
rollback;
