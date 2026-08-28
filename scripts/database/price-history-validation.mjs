import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { CatalogImporter } from "./catalog-import/import.mjs";

if (!process.argv.includes("--local")) {
  throw new Error("Este teste exige --local e nunca aceita uma conexão remota.");
}

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres", {
  max: 6,
  prepare: false,
});
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const externalBase = Number.parseInt(suffix.slice(0, 7), 16) + 900_000_000;
const category = { id: externalBase + 1, name: `Category ${suffix}`, slug: `history-category-${suffix}`, parent: 0 };
const brand = { id: externalBase + 2, name: `Brand ${suffix}`, slug: `history-brand-${suffix}` };

function product({ regularPrice, salePrice = "", changedAt }) {
  return {
    id: externalBase + 3,
    type: "simple",
    sku: `HISTORY-${suffix}`,
    global_unique_id: "",
    name: `History Product ${suffix}`,
    slug: `history-product-${suffix}`,
    status: "publish",
    date_created_gmt: "2026-08-26T00:00:00",
    date_modified_gmt: changedAt,
    regular_price: regularPrice,
    sale_price: salePrice,
    stock_quantity: 5,
    manage_stock: true,
    stock_status: "instock",
    purchasable: true,
    categories: [{ id: category.id }],
    brands: [{ id: brand.id, name: brand.name, slug: brand.slug }],
    attributes: [],
    images: [],
    tags: [],
  };
}

async function historyCount(priceId) {
  const [row] = await sql`select count(*)::int count from public.price_history where price_id=${priceId}`;
  return row.count;
}

let productId;
let variantId;
let priceId;
try {
  const options = { categories: [category], brands: [brand] };
  const initialImporter = new CatalogImporter(sql, options);
  await initialImporter.importProduct(product({ regularPrice: "71.00", changedAt: "2026-08-26T01:00:00" }));
  [{ internal_id: productId }] = await sql`select internal_id from public.external_mappings where system='woocommerce' and entity_type='product' and external_id=${String(externalBase + 3)}`;
  [{ internal_id: variantId }] = await sql`select internal_id from public.external_mappings where system='woocommerce' and entity_type='product_variant' and external_id=${String(externalBase + 3)}`;
  [{ id: priceId }] = await sql`select id from public.prices where product_variant_id=${variantId}`;
  assert.equal(await historyCount(priceId), 0, "initial price must not create history");

  const realChange = new CatalogImporter(sql, options);
  await realChange.importProduct(product({ regularPrice: "88.35", changedAt: "2026-08-26T01:01:00" }));
  assert.equal(realChange.metrics.byEntity.price.update, 1);
  assert.equal(await historyCount(priceId), 1, "7100 -> 8835 must create exactly one history row");

  const noOp = new CatalogImporter(sql, options);
  await noOp.importProduct(product({ regularPrice: "88.35", changedAt: "2026-08-26T01:01:00" }));
  assert.equal(noOp.metrics.byEntity.price.noop, 1);
  assert.equal(await historyCount(priceId), 1, "reprocessing the same snapshot must create no history");

  const saleAdd = new CatalogImporter(sql, options);
  await saleAdd.importProduct(product({ regularPrice: "88.35", salePrice: "79.90", changedAt: "2026-08-26T01:02:00" }));
  const saleChange = new CatalogImporter(sql, options);
  await saleChange.importProduct(product({ regularPrice: "88.35", salePrice: "78.90", changedAt: "2026-08-26T01:03:00" }));
  const saleRemove = new CatalogImporter(sql, options);
  await saleRemove.importProduct(product({ regularPrice: "88.35", changedAt: "2026-08-26T01:04:00" }));
  assert.equal(await historyCount(priceId), 4, "sale add/change/remove must each create one history row");

  const concurrentSnapshot = product({ regularPrice: "90.00", changedAt: "2026-08-26T01:05:00" });
  const concurrentA = new CatalogImporter(sql, options);
  const concurrentB = new CatalogImporter(sql, options);
  await Promise.all([concurrentA.importProduct(concurrentSnapshot), concurrentB.importProduct(concurrentSnapshot)]);
  assert.equal(await historyCount(priceId), 5, "two concurrent idempotent attempts must create one event");
  const concurrentUpdates = (concurrentA.metrics.byEntity.price?.update ?? 0) + (concurrentB.metrics.byEntity.price?.update ?? 0);
  assert.equal(concurrentUpdates, 1, "only one concurrent price update may win");

  const secondPass = new CatalogImporter(sql, options);
  await secondPass.importProduct(concurrentSnapshot);
  assert.equal(secondPass.metrics.byEntity.price.noop, 1);
  assert.equal(await historyCount(priceId), 5, "second pass must add zero history rows");

  const cleanupSql = await readFile(new URL("../../supabase/migrations/20260827133500_price_history_single_writer_cleanup.sql", import.meta.url), "utf8");
  const [canonical] = await sql`select * from public.price_history where price_id=${priceId} order by changed_at desc limit 1`;
  await sql`insert into public.price_history(price_id,previous_list_amount_minor,new_list_amount_minor,previous_sale_amount_minor,new_sale_amount_minor,currency,source,source_event_id,changed_at)
    select price_id,previous_list_amount_minor,new_list_amount_minor,previous_sale_amount_minor,new_sale_amount_minor,currency,source,${`product:${externalBase + 3}:2026-08-26T01:05:00Z:${externalBase + 3}`},changed_at
    from public.price_history where id=${canonical.id}`;
  await sql.unsafe(cleanupSql);
  assert.equal(await historyCount(priceId), 5, "versioned cleanup must remove the exact legacy importer twin only");

  await sql`insert into public.price_history(price_id,previous_list_amount_minor,new_list_amount_minor,previous_sale_amount_minor,new_sale_amount_minor,currency,source,source_event_id,changed_at)
    select price_id,previous_list_amount_minor,new_list_amount_minor,previous_sale_amount_minor,new_sale_amount_minor,currency,source,event_id,changed_at
    from public.price_history
    cross join (values (${`product:${externalBase + 3}:ambiguous-a:${externalBase + 3}`}),(${`product:${externalBase + 3}:ambiguous-b:${externalBase + 3}`})) events(event_id)
    where id=${canonical.id}`;
  await sql.unsafe(cleanupSql);
  assert.equal(await historyCount(priceId), 7, "versioned cleanup must preserve ambiguous groups");

  console.log(JSON.stringify({
    initialHistoryRows: 0,
    realPriceChangeRows: 1,
    noOpHistoryRows: 0,
    saleTransitions: 3,
    concurrentHistoryRows: 1,
    concurrentPriceUpdates: concurrentUpdates,
    secondPassHistoryRows: 0,
    versionedCleanupConfirmedRowsRemoved: 1,
    ambiguousRowsPreserved: 2,
    singleWriter: "postgresql_trigger",
  }));
} finally {
  if (productId) {
    await sql.begin(async (tx) => {
      await tx`delete from public.price_history where price_id in (select id from public.prices where product_variant_id=${variantId})`;
      await tx`delete from public.prices where product_variant_id=${variantId}`;
      await tx`delete from public.inventory_levels where product_variant_id=${variantId}`;
      await tx`delete from public.catalog_search_documents where product_id=${productId}`;
      await tx`delete from public.product_categories where product_id=${productId}`;
      await tx`delete from public.product_attribute_values where product_id=${productId}`;
      await tx`delete from public.product_media where product_id=${productId}`;
      await tx`delete from public.external_mappings where system='woocommerce' and internal_id in (${productId},${variantId})`;
      await tx`delete from public.product_variants where id=${variantId}`;
      await tx`delete from public.products where id=${productId}`;
      await tx`delete from public.external_mappings where system='woocommerce' and entity_type in ('category','brand') and external_id in (${String(category.id)},${String(brand.id)})`;
      await tx`delete from public.categories where slug=${category.slug}`;
      await tx`delete from public.brands where slug=${brand.slug}`;
    });
  }
  await sql.end({ timeout: 5 });
}
