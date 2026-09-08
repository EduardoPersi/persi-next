import assert from "node:assert/strict";

export const FIXTURE_TABLES = Object.freeze([
  "attributes", "attribute_values", "measurement_components", "categories",
  "products", "product_variants", "price_lists", "prices", "price_history",
  "inventory_locations", "inventory_levels", "inventory_reservations", "inventory_movements",
  "external_mappings", "stores", "store_price_list_assignments", "customers",
  "carts", "cart_items", "checkout_sessions", "checkout_session_items",
  "checkout_shipping_quotes", "checkout_shipping_evidence", "orders", "order_items", "order_addresses",
  "order_adjustments", "order_status_events",
]);

export async function captureFixtureBaseline(sql) {
  const rows = await sql`
    select table_name, (xpath('/row/count/text()', query_to_xml(
      format('select count(*) as count from public.%I', table_name), false, true, ''
    )))[1]::text::bigint as count
    from unnest(${FIXTURE_TABLES}::text[]) table_name
    order by table_name
  `;
  return Object.fromEntries(rows.map((row) => [row.table_name, String(row.count)]));
}

export function assertFixtureBaseline(before, after) {
  assert.deepEqual(after, before, "FIXTURE_CLEANUP_BASELINE_MISMATCH");
}

export function fixtureFailureRequested() {
  return process.argv.includes("--inject-fixture-failure");
}

export function injectFixtureFailureIfRequested() {
  if (fixtureFailureRequested()) throw new Error("INJECTED_FIXTURE_FAILURE");
}

export async function cleanupFixtureRun(sql, ownership) {
  const storePatterns = ownership.storeCodePrefixes?.map((value) => `${value}%`) ?? [];
  const productPatterns = ownership.productSlugPrefixes?.map((value) => `${value}%`) ?? [];
  const locationPatterns = ownership.locationCodePrefixes?.map((value) => `${value}%`) ?? [];
  const priceListPatterns = ownership.priceListCodePrefixes?.map((value) => `${value}%`) ?? [];
  const attributePatterns = ownership.attributeCodePrefixes?.map((value) => `${value}%`) ?? [];
  const categoryPatterns = ownership.categorySlugPrefixes?.map((value) => `${value}%`) ?? [];
  const customerPatterns = ownership.customerEmailPrefixes?.map((value) => `${value}%`) ?? [];

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const stores = storePatterns.length ? await tx`select id from stores where code like any(${storePatterns})` : [];
    const products = productPatterns.length ? await tx`select id from products where slug like any(${productPatterns})` : [];
    const locations = locationPatterns.length ? await tx`select id from inventory_locations where code like any(${locationPatterns})` : [];
    const lists = priceListPatterns.length ? await tx`select id from price_lists where code like any(${priceListPatterns})` : [];
    const storeIds = stores.map((row) => row.id), productIds = products.map((row) => row.id);
    const locationIds = locations.map((row) => row.id), listIds = lists.map((row) => row.id);

    if (storeIds.length) {
      await tx`delete from order_status_events where order_id in (select id from orders where store_id in ${tx(storeIds)})`;
      await tx`delete from order_adjustments where order_id in (select id from orders where store_id in ${tx(storeIds)})`;
      await tx`delete from order_addresses where order_id in (select id from orders where store_id in ${tx(storeIds)})`;
      await tx`delete from inventory_reservations where order_item_id in (select oi.id from order_items oi join orders o on o.id=oi.order_id where o.store_id in ${tx(storeIds)})`;
      await tx`delete from order_items where order_id in (select id from orders where store_id in ${tx(storeIds)})`;
      await tx`delete from orders where store_id in ${tx(storeIds)}`;
      await tx`delete from inventory_movements where reservation_id in (select r.id from inventory_reservations r join checkout_session_items i on i.id=r.checkout_session_item_id join checkout_sessions c on c.id=i.checkout_session_id where c.store_id in ${tx(storeIds)})`;
      await tx`delete from inventory_reservations where checkout_session_item_id in (select i.id from checkout_session_items i join checkout_sessions c on c.id=i.checkout_session_id where c.store_id in ${tx(storeIds)})`;
      await tx`delete from checkout_shipping_quotes where checkout_session_id in (select id from checkout_sessions where store_id in ${tx(storeIds)})`;
      await tx`delete from checkout_session_items where checkout_session_id in (select id from checkout_sessions where store_id in ${tx(storeIds)})`;
      await tx`delete from checkout_sessions where store_id in ${tx(storeIds)}`;
      await tx`delete from cart_items where cart_id in (select id from carts where store_id in ${tx(storeIds)})`;
      await tx`delete from carts where store_id in ${tx(storeIds)}`;
      await tx`delete from store_price_list_assignments where store_id in ${tx(storeIds)}`;
      await tx`delete from stores where id in ${tx(storeIds)}`;
    }
    if (productIds.length || locationIds.length) {
      await tx`delete from inventory_movements where inventory_level_id in (select id from inventory_levels where product_variant_id in (select id from product_variants where product_id in ${tx(productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])}) or inventory_location_id in ${tx(locationIds.length ? locationIds : ["00000000-0000-0000-0000-000000000000"])})`;
      await tx`delete from inventory_reservations where inventory_level_id in (select id from inventory_levels where product_variant_id in (select id from product_variants where product_id in ${tx(productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])}) or inventory_location_id in ${tx(locationIds.length ? locationIds : ["00000000-0000-0000-0000-000000000000"])})`;
      await tx`delete from inventory_levels where product_variant_id in (select id from product_variants where product_id in ${tx(productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])}) or inventory_location_id in ${tx(locationIds.length ? locationIds : ["00000000-0000-0000-0000-000000000000"])}`;
    }
    if (productIds.length) {
      await tx`delete from price_history where price_id in (select p.id from prices p join product_variants v on v.id=p.product_variant_id where v.product_id in ${tx(productIds)})`;
      await tx`delete from prices where product_variant_id in (select id from product_variants where product_id in ${tx(productIds)})`;
      await tx`delete from external_mappings where internal_id in ${tx(productIds)} or internal_id in (select id from product_variants where product_id in ${tx(productIds)})`;
      await tx`delete from product_attribute_values where product_id in ${tx(productIds)}`;
      await tx`delete from product_categories where product_id in ${tx(productIds)}`;
      await tx`delete from product_media where product_id in ${tx(productIds)}`;
      await tx`delete from product_variants where product_id in ${tx(productIds)}`;
      await tx`delete from products where id in ${tx(productIds)}`;
    }
    if (locationIds.length) await tx`delete from inventory_locations where id in ${tx(locationIds)}`;
    if (listIds.length) {
      await tx`delete from price_history where price_id in (select id from prices where price_list_id in ${tx(listIds)})`;
      await tx`delete from prices where price_list_id in ${tx(listIds)}`;
      await tx`delete from price_lists where id in ${tx(listIds)}`;
    }
    if (categoryPatterns.length) await tx`delete from categories where slug like any(${categoryPatterns})`;
    if (attributePatterns.length) {
      await tx`delete from measurement_components where attribute_value_id in (select av.id from attribute_values av join attributes a on a.id=av.attribute_id where a.code like any(${attributePatterns}))`;
      await tx`delete from attribute_values where attribute_id in (select id from attributes where code like any(${attributePatterns}))`;
      await tx`delete from attributes where code like any(${attributePatterns})`;
    }
    if (customerPatterns.length) await tx`delete from customers where email_normalized like any(${customerPatterns})`;
  });
}
