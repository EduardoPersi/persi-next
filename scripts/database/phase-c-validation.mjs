import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../lib/db/schema/index.ts";

if (!process.argv.includes("--local")) {
  throw new Error("Este teste exige --local e nunca aceita uma conexão remota.");
}

const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(localUrl, { max: 12, prepare: false });
const db = drizzle(sql, { schema });
const suffix = crypto.randomUUID();
const gtin = String((BigInt(`0x${suffix.replaceAll("-", "").slice(0, 12)}`) % 9_000_000_000_000n) + 1_000_000_000_000n);
const expiry = () => new Date(Date.now() + 300_000);

async function expectError(work, code, message) {
  await assert.rejects(work, (error) => {
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    return true;
  });
}

async function createProduct(sku, slugSuffix = crypto.randomUUID()) {
  const [product] = await sql`
    insert into public.products (name, slug)
    values ('Phase C validation', ${`phase-c-${slugSuffix}`}) returning id
  `;
  const [variant] = await sql`
    insert into public.product_variants (product_id, sku)
    values (${product.id}, ${sku}) returning id
  `;
  return { productId: product.id, variantId: variant.id };
}

try {
  const [mm, inch] = await sql`select id, code from public.units where code in ('mm', 'in') order by code`;
  assert.ok(mm && inch);

  const [attribute] = await sql`
    insert into public.attributes (
      code, name, data_type, unit_dimension, is_commercial, is_technical, is_variation
    ) values (${`measure_${suffix.replaceAll("-", "_")}`}, 'Medida composta', 'composite_measurement',
      'length', true, true, true) returning id
  `;
  const measures = [
    ['16mm x 1/2"', '16 mm x 1/2 in', [[16, 1, 'mm', 'diameter_a'], [1, 2, 'in', 'thread_b']]],
    ['25mm x 1/2"', '25 mm x 1/2 in', [[25, 1, 'mm', 'diameter_a'], [1, 2, 'in', 'thread_b']]],
    ['32mm x 3/4"', '32 mm x 3/4 in', [[32, 1, 'mm', 'diameter_a'], [3, 4, 'in', 'thread_b']]],
    ['32 x 25mm', '32 mm x 25 mm', [[32, 1, 'mm', 'diameter_a'], [25, 1, 'mm', 'diameter_b']]],
  ];
  const unitIds = { mm: mm.code === 'mm' ? mm.id : inch.id, in: mm.code === 'in' ? mm.id : inch.id };
  for (const [display, normalized, components] of measures) {
    const [value] = await sql`
      insert into public.attribute_values (attribute_id, display_value, normalized_text)
      values (${attribute.id}, ${display}, ${normalized}) returning id
    `;
    for (const [index, component] of components.entries()) {
      const [numerator, denominator, unit, role] = component;
      await sql`
        insert into public.measurement_components
          (attribute_value_id, position, semantic_role, numerator, denominator, unit_id, display_value)
        values (${value.id}, ${index + 1}, ${role}, ${numerator}, ${denominator}, ${unitIds[unit]},
          ${`${numerator}/${denominator} ${unit}`})
      `;
    }
  }
  const pimRows = await sql`
    select value.display_value, value.normalized_text, component.position, component.semantic_role,
      component.numerator, component.denominator, unit.code
    from public.attribute_values value
    join public.measurement_components component on component.attribute_value_id = value.id
    join public.units unit on unit.id = component.unit_id
    where value.attribute_id = ${attribute.id}
    order by value.display_value, component.position
  `;
  assert.equal(pimRows.length, 8);
  assert.deepEqual(new Set(pimRows.filter((row) => row.code === 'in').map((row) => `${row.numerator}/${row.denominator}`)), new Set(['1/2', '3/4']));
  for (const [numerator, denominator] of [[1, 2], [3, 4], [1, 4], [3, 8]]) {
    const [fractionAttribute] = await sql`
      insert into public.attributes (code, name, data_type, unit_dimension, is_commercial)
      values (${`fraction_${numerator}_${denominator}_${suffix.replaceAll("-", "_")}`}, 'Fração', 'measurement', 'length', true)
      returning id
    `;
    const [fraction] = await sql`
      insert into public.attribute_values
        (attribute_id, display_value, normalized_text, measurement_numerator, measurement_denominator, measurement_unit_id)
      values (${fractionAttribute.id}, ${`${numerator}/${denominator}"`}, ${`${numerator}/${denominator} in`},
        ${numerator}, ${denominator}, ${unitIds.in})
      returning measurement_numerator, measurement_denominator
    `;
    assert.equal(fraction.measurement_numerator, String(numerator));
    assert.equal(fraction.measurement_denominator, String(denominator));
  }

  const skuProduct = await createProduct(` sku-${suffix} `);
  const [skuRow] = await sql`select sku_normalized from public.product_variants where id = ${skuProduct.variantId}`;
  assert.equal(skuRow.sku_normalized, `SKU-${suffix}`.toUpperCase());
  await expectError(sql`insert into public.product_variants (product_id, sku) values (${skuProduct.productId}, ${`SKU-${suffix}`})`, '23505');
  await expectError(sql`insert into public.product_variants (product_id, sku) values (${skuProduct.productId}, '   ')`, '23514');
  await expectError(sql`insert into public.product_variants (product_id, sku) values (${skuProduct.productId}, null)`, '23502');

  const gtinProduct = await createProduct(`GTIN-${suffix}`);
  await sql`insert into public.product_variants (product_id, sku, gtin) values
    (${gtinProduct.productId}, ${`GTIN-NULL-${suffix}`}, null),
    (${gtinProduct.productId}, ${`GTIN-VALID-${suffix}`}, ${gtin})`;
  await expectError(sql`insert into public.product_variants (product_id, sku, gtin) values (${gtinProduct.productId}, ${`GTIN-DUP-${suffix}`}, ${gtin})`, '23505');
  await expectError(sql`insert into public.product_variants (product_id, sku, gtin) values (${gtinProduct.productId}, ${`GTIN-EMPTY-${suffix}`}, '')`, '23514');
  await expectError(sql`insert into public.product_variants (product_id, sku, gtin) values (${gtinProduct.productId}, ${`GTIN-SPACE-${suffix}`}, ${` ${gtin} `})`, '23514');

  const money = [1n, 1990n, 199990n, 99999999n];
  const [priceList] = await sql`
    insert into public.price_lists (code, name, currency, status)
    values (${`validation-${suffix}`}, 'Validation', 'BRL', 'active') returning id
  `;
  for (const [index, amount] of money.entries()) {
    const entity = await createProduct(`MONEY-${index}-${suffix}`);
    await sql`insert into public.prices (product_variant_id, price_list_id, list_amount_minor, currency)
      values (${entity.variantId}, ${priceList.id}, ${amount}, 'BRL')`;
  }
  const storedMoney = await sql`select list_amount_minor from public.prices where price_list_id = ${priceList.id} order by list_amount_minor`;
  assert.deepEqual(storedMoney.map((row) => row.list_amount_minor), money.map(String));
  const pricingEntity = await createProduct(`PRICE-${suffix}`);
  await sql`insert into public.prices (product_variant_id, price_list_id, list_amount_minor, sale_amount_minor, currency, valid_from, valid_to)
    values (${pricingEntity.variantId}, ${priceList.id}, 1990, 1500, 'BRL', now(), now() + interval '1 day')`;
  await expectError(sql`insert into public.prices (product_variant_id, price_list_id, list_amount_minor, currency) values (${pricingEntity.variantId}, ${priceList.id}, 1000, 'BRL')`, '23P01', 'overlapping_active_price_period');
  const invalidPriceEntity = await createProduct(`PRICE-INVALID-${suffix}`);
  await expectError(sql`insert into public.prices (product_variant_id, price_list_id, list_amount_minor, currency) values (${invalidPriceEntity.variantId}, ${priceList.id}, -1, 'BRL')`, '23514');
  await expectError(sql`insert into public.prices (product_variant_id, price_list_id, list_amount_minor, sale_amount_minor, currency) values (${invalidPriceEntity.variantId}, ${priceList.id}, 1000, 1001, 'BRL')`, '23514');
  await sql`insert into public.prices (product_variant_id, price_list_id, list_amount_minor, currency, status) values (${invalidPriceEntity.variantId}, ${priceList.id}, 0, 'BRL', 'draft')`;

  const workflow = await createProduct(`WORKFLOW-${suffix}`);
  await sql`update public.product_variants set status = 'active' where id = ${workflow.variantId}`;
  await sql`update public.products set status = 'active', published_at = now() where id = ${workflow.productId}`;
  await sql`update public.products set name = 'Updated active product' where id = ${workflow.productId}`;
  await expectError(sql`update public.product_variants set status = 'archived' where id = ${workflow.variantId}`, '23514', 'active_product_requires_active_variant');
  await sql`update public.products set status = 'archived', archived_at = now() where id = ${workflow.productId}`;
  await sql`update public.product_variants set status = 'archived', archived_at = now() where id = ${workflow.variantId}`;

  const [root] = await sql`insert into public.categories (name, slug) values ('Root', ${`root-${suffix}`}) returning id`;
  const [child] = await sql`insert into public.categories (parent_id, name, slug) values (${root.id}, 'Child', ${`child-${suffix}`}) returning id`;
  const [deep] = await sql`insert into public.categories (parent_id, name, slug) values (${child.id}, 'Deep', ${`deep-${suffix}`}) returning id`;
  await expectError(sql`update public.categories set parent_id = id where id = ${root.id}`, '23514');
  await sql`update public.categories set parent_id = ${deep.id} where id = ${root.id}`;
  const [cycleAccepted] = await sql`select parent_id = ${deep.id} as accepted from public.categories where id = ${root.id}`;
  assert.equal(cycleAccepted.accepted, true);

  const inventoryEntity = await createProduct(`INV-${suffix}`);
  const [location] = await sql`insert into public.inventory_locations (code, name, status) values (${`inv-${suffix}`}, 'Inventory', 'active') returning id`;
  const [level] = await sql`insert into public.inventory_levels (product_variant_id, inventory_location_id, quantity_on_hand) values (${inventoryEntity.variantId}, ${location.id}, 10) returning id`;
  const [reserveThree] = await sql`select * from public.reserve_inventory(${level.id}, 3, 'test', 'three', ${`reserve-3-${suffix}`}, ${expiry().toISOString()})`;
  let [levelState] = await sql`select quantity_on_hand, quantity_reserved, quantity_available from public.inventory_levels where id = ${level.id}`;
  assert.deepEqual([levelState.quantity_on_hand, levelState.quantity_reserved, levelState.quantity_available], ['10', '3', '7']);
  const [sameReservation] = await sql`select * from public.reserve_inventory(${level.id}, 3, 'test', 'three', ${`reserve-3-${suffix}`}, ${expiry().toISOString()})`;
  assert.equal(sameReservation.id, reserveThree.id);
  await sql`select * from public.release_inventory_reservation(${reserveThree.id}, ${`release-3-${suffix}`})`;
  const [reserveOne] = await sql`select * from public.reserve_inventory(${level.id}, 1, 'test', 'one', ${`reserve-1-${suffix}`}, ${expiry().toISOString()})`;
  const [reserveTwo] = await sql`select * from public.reserve_inventory(${level.id}, 2, 'test', 'two', ${`reserve-2-${suffix}`}, ${expiry().toISOString()})`;
  await sql`select * from public.release_inventory_reservation(${reserveTwo.id}, ${`release-2-${suffix}`})`;
  [levelState] = await sql`select quantity_on_hand, quantity_reserved, quantity_available from public.inventory_levels where id = ${level.id}`;
  assert.deepEqual([levelState.quantity_on_hand, levelState.quantity_reserved, levelState.quantity_available], ['10', '1', '9']);
  await sql`select * from public.confirm_inventory_reservation(${reserveOne.id}, ${`confirm-1-${suffix}`})`;
  [levelState] = await sql`select quantity_on_hand, quantity_reserved, quantity_available from public.inventory_levels where id = ${level.id}`;
  assert.deepEqual([levelState.quantity_on_hand, levelState.quantity_reserved, levelState.quantity_available], ['9', '0', '9']);
  const movementTypes = await sql`select movement_type from public.inventory_movements where inventory_level_id = ${level.id}`;
  assert.deepEqual(new Set(movementTypes.map((row) => row.movement_type)), new Set(['reservation', 'release', 'sale']));

  const conflictEntity = await createProduct(`OLIST-${suffix}`);
  const [conflictLevel] = await sql`insert into public.inventory_levels (product_variant_id, inventory_location_id, quantity_on_hand) values (${conflictEntity.variantId}, ${location.id}, 10) returning id`;
  await sql`select * from public.reserve_inventory(${conflictLevel.id}, 3, 'test', 'olist', ${`olist-reserve-${suffix}`}, ${expiry().toISOString()})`;
  await sql`select * from public.adjust_inventory(${conflictLevel.id}, 8, 'olist', ${`olist-8-${suffix}`}, 'sync')`;
  const [olistState] = await sql`select quantity_on_hand, quantity_reserved, quantity_available from public.inventory_levels where id = ${conflictLevel.id}`;
  assert.deepEqual([olistState.quantity_on_hand, olistState.quantity_reserved, olistState.quantity_available], ['8', '3', '5']);
  await expectError(sql`select * from public.adjust_inventory(${conflictLevel.id}, 2, 'olist', ${`olist-2-${suffix}`}, 'conflict')`, '23514', 'adjustment_below_reserved_inventory');

  await sql`insert into public.external_mappings (system, entity_type, internal_id, external_id) values
    ('woocommerce', 'product', ${workflow.productId}, '123'),
    ('olist', 'product', ${workflow.productId}, 'ABC123')`;
  await expectError(sql`insert into public.external_mappings (system, entity_type, internal_id, external_id) values ('woocommerce', 'product', ${skuProduct.productId}, '123')`, '23505');

  const drizzleProduct = await db.query.products.findFirst({ where: eq(schema.products.id, workflow.productId) });
  const drizzleVariant = await db.query.productVariants.findFirst({ where: eq(schema.productVariants.id, workflow.variantId) });
  const drizzlePrice = await db.query.prices.findFirst({ where: eq(schema.prices.priceListId, priceList.id) });
  const drizzleInventory = await db.query.inventoryLevels.findFirst({ where: eq(schema.inventoryLevels.id, level.id) });
  const drizzleMapping = await db.query.externalMappings.findFirst({ where: eq(schema.externalMappings.internalId, workflow.productId) });
  assert.ok(drizzleProduct && drizzleVariant && drizzlePrice && drizzleInventory && drizzleMapping);
  assert.equal(typeof drizzlePrice.listAmountMinor, 'bigint');
  assert.equal(typeof drizzleInventory.quantityOnHand, 'bigint');

  process.stdout.write(JSON.stringify({
    pim: { commercialValues: measures.length, components: pimRows.length, fractionsExact: true },
    sku: { normalized: true, duplicateRejected: true, blankRejected: true, nullRejected: true },
    gtin: { nullAllowed: true, duplicateRejected: true, blankRejected: true, whitespaceRejected: true },
    money: storedMoney.map((row) => row.list_amount_minor),
    pricing: { overlapRejected: true, negativeRejected: true, saleAboveListRejected: true, zeroAllowed: true },
    productVariant: { workflowPassed: true, activeProtectionPassed: true },
    categories: { hierarchyPassed: true, selfParentRejected: true, deepCycleAcceptedByDatabase: true },
    inventory: { basicPassed: true, idempotencyPassed: true, ledgerPassed: true },
    olist: { validAdjustment: ['8', '3', '5'], belowReservedRejected: true },
    externalMappings: { crossSystemAllowed: true, duplicateRejected: true },
    drizzle: { queriesPassed: true, bigintType: 'bigint' },
  }, null, 2) + '\n');
} finally {
  await sql.end();
}
