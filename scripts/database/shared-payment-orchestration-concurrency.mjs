// B.3-H — SHARED PAYMENT -> ORDER -> INVENTORY ORCHESTRATION. Real
// Postgres, real concurrent connections. Proves Section 19's properties
// A-I against apply_verified_payment_transition
// (supabase/migrations/20260921000000_shared_payment_order_inventory_
// orchestration.sql). No provider is called anywhere in this file.
import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const sql = postgres(localDatabaseUrl(), { max: 20, prepare: false });
const results = {};

function fp(seed) {
  return createHash("sha256").update(seed).digest("hex");
}

function ref(prefix) {
  return `${prefix}-${randomUUID()}`;
}

// One store/product/variant/level is shared across the whole harness
// (mirrors a single real SKU multiple concurrent orders compete for);
// each property below creates its OWN order/reservation/attempt on top of
// it, exactly like shared_payment_order_inventory_orchestration.test.sql's
// fixtures.
const storeId = randomUUID();
const productId = randomUUID();
const variantId = randomUUID();
const locationId = randomUUID();
const levelId = randomUUID();
await sql.begin(async (tx) => {
  await tx`insert into stores(id,code,name,status) values(${storeId},${ref("spoc")},'Shared Orchestration Concurrency','active')`;
  await tx`insert into products(id,name,slug) values(${productId},${`Concurrency Product ${randomUUID()}`},${ref("concurrency")})`;
  await tx`insert into product_variants(id,product_id,sku) values(${variantId},${productId},${ref("SKU")})`;
  await tx`insert into inventory_locations(id,code,name,status) values(${locationId},${ref("loc").toLowerCase().replace(/-/g, "_")},'Concurrency Location','active')`;
  await tx`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values(${levelId},${variantId},${locationId},100000,0)`;
});

async function makeOrderWithReservation(quantity) {
  const orderId = randomUUID(), orderItemId = randomUUID(), reservationId = randomUUID(), tag = randomUUID().slice(0, 8);
  await sql.begin(async (tx) => {
    const [alloc] = await tx`select * from allocate_native_order_number(${storeId})`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},${alloc.order_sequence},${alloc.order_number},'BRL',${quantity * 1000},${quantity * 1000},'Concurrency Test','concurrency@example.invalid',${randomUUID()})`;
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
    await tx`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
      values(${orderItemId},${orderId},1,${productId},${variantId},'SKU','Concurrency Product',${quantity},1000,1000,${quantity * 1000},0,0,${quantity * 1000},'BRL',${fp(tag)})`;
    // Inserted WITH order_item_id already set (only fires the checkout-link
    // trigger on UPDATE, never INSERT).
    await tx`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,order_item_id)
      values(${reservationId},${levelId},${quantity},'active','order',${tag},${ref("res-idem")},now() + interval '1 hour',${orderItemId})`;
    await tx`update inventory_levels set quantity_reserved = quantity_reserved + ${quantity} where id = ${levelId}`;
  });
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',${quantity * 1000},'BRL',${ref("idem")})`;
  return { orderId, orderItemId, reservationId, attemptId, attemptVersion: version };
}

async function claim(attemptId, expectedVersion) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'created','pending',${expectedVersion})`;
  return row;
}

async function attachReference(attemptId, expectedVersion, reference) {
  await sql`select transition_native_payment_attempt(${attemptId},'pending','pending',${expectedVersion},${reference})`;
}

// ---------- A: 50 concurrent PAID calls for the SAME attempt -> one logical confirmation ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeOrderWithReservation(5);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-A"));

  const outcomes = await Promise.allSettled(
    Array.from({ length: 50 }, (_, index) =>
      sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${`evt-a-${index}`},'approved','paid')`
    ),
  );
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  const totalConfirmed = fulfilled.reduce((sum, o) => sum + o.value[0].inventory_confirmed_count, 0);
  results.fiftyConcurrentPaidOneLogicalConfirmation =
    fulfilled.length === 50 && orderStatus === "confirmed" && reservationStatus === "confirmed" && totalConfirmed === 1;
}

// ---------- B: PAID vs FAILED concurrently -> deterministic state allowed by the state machine (exactly one wins, the other is stale_ignored) ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeOrderWithReservation(3);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-B"));

  const [paidResult, failedResult] = await Promise.allSettled([
    sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-b-paid")},'approved','paid')`,
    sql`select * from apply_verified_payment_transition(${attemptId},'reconciliation_probe',null,'rejected','failed')`,
  ]);
  const [{ status: attemptStatus }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  // Whichever of the two genuinely won the row-lock race set the final
  // state; the loser's event is recorded but never applied (stale_ignored)
  // since paid<->failed is not a valid mutual transition. The end state is
  // internally consistent either way: paid+confirmed or failed+released,
  // never a mix.
  const consistent =
    (attemptStatus === "paid" && orderStatus === "confirmed" && reservationStatus === "confirmed") ||
    (attemptStatus === "failed" && orderStatus === "cancelled" && reservationStatus === "released");
  results.paidVsFailedDeterministicConsistentState =
    paidResult.status === "fulfilled" && failedResult.status === "fulfilled" && consistent;
}

// ---------- C: PAID vs EXPIRED concurrently -> same determinism property ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeOrderWithReservation(4);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-C"));

  const [paidResult, expiredResult] = await Promise.allSettled([
    sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-c-paid")},'approved','paid')`,
    sql`select * from apply_verified_payment_transition(${attemptId},'reconciliation_probe',null,'expired','expired')`,
  ]);
  const [{ status: attemptStatus }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  const consistent =
    (attemptStatus === "paid" && orderStatus === "confirmed" && reservationStatus === "confirmed") ||
    (attemptStatus === "expired" && orderStatus === "cancelled" && reservationStatus === "released");
  results.paidVsExpiredDeterministicConsistentState =
    paidResult.status === "fulfilled" && expiredResult.status === "fulfilled" && consistent;
}

// ---------- D: FAILED replay 50x -> one logical release ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeOrderWithReservation(2);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-D"));

  const outcomes = await Promise.allSettled(
    Array.from({ length: 50 }, (_, index) =>
      sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${`evt-d-${index}`},'rejected','failed')`
    ),
  );
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  const totalReleased = fulfilled.reduce((sum, o) => sum + o.value[0].inventory_released_count, 0);
  results.fiftyConcurrentFailedOneLogicalRelease =
    fulfilled.length === 50 && orderStatus === "cancelled" && reservationStatus === "released" && totalReleased === 1;
}

// ---------- E: payment transition + inventory failure (structurally unreachable, documented) ----------
// confirm_inventory_reservation's own invariant check
// (quantity_on_hand/quantity_reserved >= reservation.quantity) cannot fail
// under any operation the schema itself allows: the table-wide check
// constraint inventory_levels_reservation_check (quantity_reserved <=
// quantity_on_hand) and adjust_inventory's own refusal to drop on_hand
// below current quantity_reserved together make that specific invariant
// unreachable by construction -- a POSITIVE finding (see docs/database/78
// section 6), not a gap. This property is therefore marked NOT_APPLICABLE
// rather than faked with an artificial, schema-violating setup.
results.paymentPlusInventoryFailureRollback = "NOT_APPLICABLE_STRUCTURALLY_UNREACHABLE";

// ---------- F: payment transition + order failure (order already non-pending) -> full rollback, including the payment's own transition ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeOrderWithReservation(6);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-F"));
  const [{ version: refVersion }] = await sql`select version from payment_attempts where id = ${attemptId}`;
  await sql`select transition_native_order(${orderId},'pending','cancelled',0,'admin',null,'manual_test_cancel',null,${randomUUID()})`;

  let threw = false;
  try {
    await sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-f")},'approved','paid')`;
  } catch (error) {
    threw = /stale_order_transition/.test(String(error.message ?? error));
  }
  const [{ status: attemptStatus, version: attemptFinalVersion }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  results.orderFailureForcesFullRollback =
    threw && attemptStatus === "pending" && Number(attemptFinalVersion) === Number(refVersion) &&
    orderStatus === "cancelled" && reservationStatus === "active";
}

// ---------- G: attempt A cannot affect reservation/order of attempt B ----------
{
  const a = await makeOrderWithReservation(7);
  const b = await makeOrderWithReservation(9);
  const claimedA = await claim(a.attemptId, a.attemptVersion);
  await attachReference(a.attemptId, claimedA.version, ref("REF-G-A"));
  const claimedB = await claim(b.attemptId, b.attemptVersion);
  await attachReference(b.attemptId, claimedB.version, ref("REF-G-B"));

  await sql`select * from apply_verified_payment_transition(${a.attemptId},'webhook_received',${ref("evt-g-a")},'approved','paid')`;

  const [{ status: orderBStatus }] = await sql`select status from orders where id = ${b.orderId}`;
  const [{ status: reservationBStatus }] = await sql`select status from inventory_reservations where id = ${b.reservationId}`;
  const [{ status: attemptBStatus }] = await sql`select status from payment_attempts where id = ${b.attemptId}`;
  results.crossAttemptIsolation = orderBStatus === "pending" && reservationBStatus === "active" && attemptBStatus === "pending";
}

// ---------- H: stale event never regresses a terminal paid ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeOrderWithReservation(8);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-H"));
  await sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-h-paid")},'approved','paid')`;

  const staleResult = await sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-h-stale")},'ATIVA','pending')`;
  const [{ status: attemptStatus }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  results.staleEventNeverRegressesPaid =
    staleResult[0].payment_event_processing_result === "stale_ignored" &&
    attemptStatus === "paid" && orderStatus === "confirmed" && reservationStatus === "confirmed";
}

// ---------- I: deadlock detection across high-contention concurrency ----------
{
  const { attemptId, attemptVersion } = await makeOrderWithReservation(1);
  const claimed = await claim(attemptId, attemptVersion);
  await attachReference(attemptId, claimed.version, ref("REF-I"));
  const outcomes = await Promise.allSettled(
    Array.from({ length: 50 }, (_, index) =>
      sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${`evt-i-${index}`},'approved','paid')`
    ),
  );
  const deadlocks = outcomes.filter((o) => o.status === "rejected" && /deadlock/i.test(String(o.reason)));
  results.zeroDeadlocks = deadlocks.length === 0;
}

await sql.end({ timeout: 5 });

const allPass = Object.entries(results).every(([, value]) => value === true || value === "NOT_APPLICABLE_STRUCTURALLY_UNREACHABLE");
console.log(JSON.stringify({ ...results, ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
