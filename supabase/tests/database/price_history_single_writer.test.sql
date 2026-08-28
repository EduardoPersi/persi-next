begin;
create extension if not exists pgtap with schema extensions;
alter extension pgtap set schema public;
select plan(14);

select has_function('public', 'capture_price_history', array[]::text[], 'price history capture function exists');
select trigger_is(
  'public', 'prices', 'prices_capture_history',
  'public', 'capture_price_history',
  'prices use the PostgreSQL history writer'
);

insert into public.brands (id, name, slug) values
  ('91000000-0000-0000-0000-000000000001', 'Marca History', 'marca-history');
insert into public.categories (id, name, slug) values
  ('92000000-0000-0000-0000-000000000001', 'Categoria History', 'categoria-history');
insert into public.products (id, brand_id, primary_category_id, name, slug) values
  ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001',
   '92000000-0000-0000-0000-000000000001', 'Produto History', 'produto-history');
insert into public.product_variants (id, product_id, sku) values
  ('94000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'HISTORY-001');
insert into public.price_lists (id, code, name, currency, status) values
  ('95000000-0000-0000-0000-000000000001', 'history-brl', 'History BRL', 'BRL', 'active');
insert into public.prices (
  id, product_variant_id, price_list_id, list_amount_minor, currency, source
) values (
  '96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001', 7100, 'BRL', 'woocommerce'
);

select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 0::bigint, 'initial price creates no history');

update public.prices set list_amount_minor = 8835 where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 1::bigint, '7100 to 8835 creates exactly one event');
select ok(exists(
  select 1 from public.price_history
  where price_id = '96000000-0000-0000-0000-000000000001'
    and previous_list_amount_minor = 7100 and new_list_amount_minor = 8835
    and previous_sale_amount_minor is null and new_sale_amount_minor is null
), 'regular price event preserves the exact transition');

update public.prices set list_amount_minor = 8835 where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 1::bigint, 'regular price no-op creates zero events');

update public.prices set updated_at = now() + interval '1 second' where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 1::bigint, 'technical timestamp-only update creates zero events');

update public.prices set sale_amount_minor = 7990, sale_valid_from = now(), sale_valid_to = now() + interval '1 day' where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 2::bigint, 'adding a sale price creates exactly one event');

update public.prices set sale_valid_to = sale_valid_to + interval '1 day' where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 2::bigint, 'sale validity-only update creates zero events under current amount-history semantics');

update public.prices set sale_amount_minor = 7990 where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 2::bigint, 'sale price no-op creates zero events');

update public.prices set sale_amount_minor = 7890 where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 3::bigint, 'changing a sale price creates exactly one event');

update public.prices set sale_amount_minor = null, sale_valid_from = null, sale_valid_to = null where id = '96000000-0000-0000-0000-000000000001';
select is((select count(*) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 4::bigint, 'removing a sale price creates exactly one event');
select ok(not exists(
  select 1 from public.price_history
  where price_id = '96000000-0000-0000-0000-000000000001'
    and (currency <> 'BRL' or source <> 'woocommerce')
), 'history preserves currency and source from the price row');
select is((select count(distinct price_id) from public.price_history where price_id = '96000000-0000-0000-0000-000000000001'), 1::bigint, 'history remains attached to the price identity carrying variant and price list');

select * from finish();
rollback;
