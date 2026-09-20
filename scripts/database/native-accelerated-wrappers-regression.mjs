// ACCELERATED ROUND — Tracks A & D: TypeScript wrapper regression.
//
// Track A's own concurrency script (native-reservation-expiration-recovery-
// concurrency.mjs) and Track D's design both reuse SQL functions/queries
// directly proven correct at the SQL layer, but neither script above
// actually calls the TS wrapper functions themselves
// (reclaimExpiredNativeReservations, processExpiredNativeReservations,
// findNativePaymentAttemptByProviderReference,
// listStaleNativePendingPaymentAttempts, processNativePendingReconciliation)
// -- this script closes that gap: real local Postgres, real wrapper
// functions, proving the column aliasing/type casts in each wrapper are
// correct, not just the underlying SQL.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";
import { reclaimExpiredNativeReservations, findNativePaymentAttemptByProviderReference, listStaleNativePendingPaymentAttempts } from "../../lib/db/nativePayment.ts";
import { processExpiredNativeReservations } from "../../lib/commerce/reservationExpirationWorker.ts";
import { processNativePendingReconciliation } from "../../lib/commerce/nativePaymentReconciliationWorker.ts";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");
if (process.env.DATABASE_URL) throw new Error("REFUSING_TO_USE_ENV_DATABASE_URL_THIS_SCRIPT_MUST_TARGET_LOCAL_ONLY");
process.env.DATABASE_URL = localDatabaseUrl();

const sql = postgres(localDatabaseUrl(), { max: 10, prepare: false });
const results = {};
const tag = () => `aud-${randomUUID().slice(0, 8)}`;

const storeId = randomUUID();
await sql`insert into stores(id,code,name,status,default_currency) values(${storeId},${tag()},'Wrapper Regression Store','active','BRL')`;

async function makeOrder() {
  const orderId = randomUUID();
  await sql.begin(async (tx) => {
    const [alloc] = await tx`select * from allocate_native_order_number(${storeId})`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},${alloc.order_sequence},${alloc.order_number},'BRL',5000,5000,'Wrapper Regression','wrapper@example.invalid',${randomUUID()})`;
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
  });
  return orderId;
}

// ---------- reclaimExpiredNativeReservations (TS wrapper) ----------
{
  const locationId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), levelId = randomUUID();
  await sql`insert into inventory_locations(id,code,name,status) values(${locationId},${tag()},'Wrapper Regression Location','active')`;
  await sql`insert into products(id,name,slug,status) values(${productId},'Wrapper Regression Product',${tag()},'draft')`;
  await sql`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${tag().toUpperCase()},'active')`;
  await sql`update products set status='active', published_at=now() where id=${productId}`;
  await sql`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values(${levelId},${variantId},${locationId},100,5)`;

  const orderId = await makeOrder();
  const orderItemId = randomUUID(), reservationId = randomUUID();
  await sql`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
    values(${orderItemId},${orderId},1,${productId},${variantId},'SKU','Wrapper Regression Product',5,1000,1000,5000,0,0,5000,'BRL',${randomUUID().replace(/-/g, "").padEnd(64, "0")})`;
  await sql`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id)
    values(${reservationId},${levelId},5,'active','order',${tag()},${randomUUID()},now()-interval '5 minutes',now()-interval '1 hour',${orderItemId})`;

  const batch = await reclaimExpiredNativeReservations(10, "wrapper-regression");
  const [{ status }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  results.reclaimExpiredNativeReservations_wrapperReleasesRealRow =
    batch.some((row) => row.reservationId === reservationId && row.released === true) && status === "released";
}

// ---------- processExpiredNativeReservations (worker, real DB) ----------
{
  const locationId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), levelId = randomUUID();
  await sql`insert into inventory_locations(id,code,name,status) values(${locationId},${tag()},'Wrapper Regression Location B','active')`;
  await sql`insert into products(id,name,slug,status) values(${productId},'Wrapper Regression Product B',${tag()},'draft')`;
  await sql`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${tag().toUpperCase()},'active')`;
  await sql`update products set status='active', published_at=now() where id=${productId}`;
  await sql`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values(${levelId},${variantId},${locationId},100,2)`;

  const orderId = await makeOrder();
  const orderItemId = randomUUID(), reservationId = randomUUID();
  await sql`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
    values(${orderItemId},${orderId},1,${productId},${variantId},'SKU','Wrapper Regression Product B',2,1000,1000,2000,0,0,2000,'BRL',${randomUUID().replace(/-/g, "").padEnd(64, "0")})`;
  await sql`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id)
    values(${reservationId},${levelId},2,'active','order',${tag()},${randomUUID()},now()-interval '5 minutes',now()-interval '1 hour',${orderItemId})`;

  const summary = await processExpiredNativeReservations({ batchSize: 10 });
  const [{ status }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  results.processExpiredNativeReservations_workerReleasesRealRow =
    status === "released" && summary.batches >= 1 && summary.reclaimed >= 1 && summary.truncated === false;
}

// ---------- findNativePaymentAttemptByProviderReference ----------
{
  const orderId = await makeOrder();
  const reference = `ref-${randomUUID()}`;
  const [attempt] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',5000,'BRL',${randomUUID()})`;
  await sql`select transition_native_payment_attempt(${attempt.id},'created','pending',${attempt.version},${reference})`;

  const found = await findNativePaymentAttemptByProviderReference("mercado_pago", reference);
  const missing = await findNativePaymentAttemptByProviderReference("mercado_pago", `unknown-${randomUUID()}`);
  results.findNativePaymentAttemptByProviderReference_findsRealRow = found?.id === attempt.id && found?.status === "pending";
  results.findNativePaymentAttemptByProviderReference_returnsNullForUnknown = missing === null;
}

// ---------- listStaleNativePendingPaymentAttempts + processNativePendingReconciliation ----------
{
  const orderId = await makeOrder();
  const reference = `stale-${randomUUID()}`;
  const [attempt] = await sql`select id, version from create_native_payment_attempt(${orderId},'pagbank','apple_pay',5000,'BRL',${randomUUID()})`;
  await sql`select transition_native_payment_attempt(${attempt.id},'created','pending',${attempt.version},${reference})`;
  await sql`update payment_attempts set updated_at = now() - interval '1 hour' where id = ${attempt.id}`;

  const stale = await listStaleNativePendingPaymentAttempts(15 * 60_000, 50);
  results.listStaleNativePendingPaymentAttempts_findsRealStaleRow = stale.some((row) => row.id === attempt.id && row.providerReference === reference);

  const reconciledIds = [];
  const summary = await processNativePendingReconciliation({
    staleAfterMs: 15 * 60_000,
    reconcileByProvider: async (candidate) => {
      reconciledIds.push(candidate.id);
    },
  });
  results.processNativePendingReconciliation_dispatchesRealStaleRow =
    reconciledIds.includes(attempt.id) && summary.checked >= 1 && summary.reconciled >= 1 && summary.errors === 0;
}

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every((value) => value === true);
console.log(JSON.stringify({ ...results, ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
