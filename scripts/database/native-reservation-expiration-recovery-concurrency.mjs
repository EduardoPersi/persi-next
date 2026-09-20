// ACCELERATED ROUND — Track A: PENDING RESERVATION EXPIRATION / RECOVERY.
// Real Postgres, real concurrent connections. Proves properties A1-A10
// against reclaim_expired_native_reservations (supabase/migrations/
// 20260922000000_native_reservation_expiration_recovery.sql), including its
// convergence with apply_verified_payment_transition (shared_payment_order_
// inventory_orchestration.sql). No provider is called anywhere in this file.
import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const sql = postgres(localDatabaseUrl(), { max: 25, prepare: false });
const results = {};

function fp(seed) {
  return createHash("sha256").update(seed).digest("hex");
}

function ref(prefix) {
  return `${prefix}-${randomUUID()}`;
}

const storeId = randomUUID();
const productId = randomUUID();
const variantId = randomUUID();
const locationId = randomUUID();
const levelId = randomUUID();
await sql.begin(async (tx) => {
  await tx`insert into stores(id,code,name,status) values(${storeId},${ref("rerc")},'Reservation Expiration Concurrency','active')`;
  await tx`insert into products(id,name,slug) values(${productId},${`RERC Product ${randomUUID()}`},${ref("rerc-product")})`;
  await tx`insert into product_variants(id,product_id,sku) values(${variantId},${productId},${ref("SKU")})`;
  await tx`insert into inventory_locations(id,code,name,status) values(${locationId},${ref("loc").toLowerCase().replace(/-/g, "_")},'RERC Location','active')`;
  await tx`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values(${levelId},${variantId},${locationId},1000000,0)`;
});

// `expiresInPastMinutes` requires an equally-past `createdAt` to satisfy
// inventory_reservations_expiry_check (expires_at > created_at) while still
// landing the reservation's expiry in the past relative to now() -- exactly
// the same fixture technique the pgTAP suite uses.
async function makeReservation(quantity, { expiresInPastMinutes = null, expiresInFutureMinutes = null, withPaymentAttempt = false } = {}) {
  const orderId = randomUUID(), orderItemId = randomUUID(), reservationId = randomUUID(), tag = randomUUID().slice(0, 8);
  const createdAtExpr = expiresInPastMinutes != null ? sql`now() - interval '1 hour'` : sql`now()`;
  const expiresAtExpr =
    expiresInPastMinutes != null
      ? sql`now() - make_interval(mins => ${expiresInPastMinutes})`
      : sql`now() + make_interval(mins => ${expiresInFutureMinutes ?? 60})`;

  await sql.begin(async (tx) => {
    const [alloc] = await tx`select * from allocate_native_order_number(${storeId})`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},${alloc.order_sequence},${alloc.order_number},'BRL',${quantity * 1000},${quantity * 1000},'RERC Test','rerc@example.invalid',${randomUUID()})`;
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
    await tx`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
      values(${orderItemId},${orderId},1,${productId},${variantId},'SKU','RERC Product',${quantity},1000,1000,${quantity * 1000},0,0,${quantity * 1000},'BRL',${fp(tag)})`;
    await tx`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id)
      values(${reservationId},${levelId},${quantity},'active','order',${tag},${ref("res-idem")},${expiresAtExpr},${createdAtExpr},${orderItemId})`;
    await tx`update inventory_levels set quantity_reserved = quantity_reserved + ${quantity} where id = ${levelId}`;
  });

  let attemptId = null, attemptVersion = null;
  if (withPaymentAttempt) {
    [{ id: attemptId, version: attemptVersion }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',${quantity * 1000},'BRL',${ref("idem")})`;
  }
  return { orderId, orderItemId, reservationId, attemptId, attemptVersion };
}

async function claimAndAttach(attemptId, attemptVersion, refTag) {
  const [claimed] = await sql`select * from transition_native_payment_attempt(${attemptId},'created','pending',${attemptVersion})`;
  await sql`select transition_native_payment_attempt(${attemptId},'pending','pending',${claimed.version},${refTag})`;
}

async function reclaim(batchSize = 100, actor = "rerc-test") {
  return sql`select * from reclaim_expired_native_reservations(${batchSize},${actor})`;
}

// ---------- A1: one expired reservation -> released once, quantities correct; a non-expired sibling untouched ----------
{
  const expired = await makeReservation(5, { expiresInPastMinutes: 5 });
  const untouched = await makeReservation(3, { expiresInFutureMinutes: 60 });
  const before = await sql`select quantity_on_hand, quantity_reserved from inventory_levels where id = ${levelId}`;

  const batch = await reclaim();
  const releasedThisBatch = batch.filter((r) => r.reservation_id === expired.reservationId);
  const [{ status: expiredStatus }] = await sql`select status from inventory_reservations where id = ${expired.reservationId}`;
  const [{ status: untouchedStatus }] = await sql`select status from inventory_reservations where id = ${untouched.reservationId}`;
  const after = await sql`select quantity_on_hand, quantity_reserved from inventory_levels where id = ${levelId}`;

  results.a1_singleExpiredReservationReleasedOnce =
    releasedThisBatch.length === 1 && releasedThisBatch[0].released === true &&
    expiredStatus === "released" && untouchedStatus === "active" &&
    Number(after[0].quantity_reserved) === Number(before[0].quantity_reserved) - 5 &&
    Number(after[0].quantity_on_hand) === Number(before[0].quantity_on_hand);
  results.a6_a7_crossOrderAndReservationIsolation =
    !batch.some((r) => r.reservation_id === untouched.reservationId);
  results.a8_nonExpiredUntouched = untouchedStatus === "active";
}

// ---------- A2: same job repeated 50x -> exactly one logical release, no duplicate movement ----------
{
  const { reservationId } = await makeReservation(4, { expiresInPastMinutes: 5 });
  const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => reclaim()));
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const totalReleasedForThisReservation = fulfilled.reduce(
    (sum, o) => sum + o.value.filter((r) => r.reservation_id === reservationId && r.released).length,
    0,
  );
  const [{ status }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  const [{ count }] = await sql`select count(*)::int as count from inventory_movements where reservation_id = ${reservationId} and movement_type = 'release'`;
  results.a2_repeatedJobIsOneLogicalRelease =
    fulfilled.length === 50 && status === "released" && totalReleasedForThisReservation === 1 && Number(count) === 1;
}

// ---------- A3: 50 concurrent workers racing the SAME single expired reservation -> one logical release, no errors ----------
{
  const { reservationId } = await makeReservation(6, { expiresInPastMinutes: 5 });
  const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => reclaim()));
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const totalReleased = fulfilled.reduce(
    (sum, o) => sum + o.value.filter((r) => r.reservation_id === reservationId && r.released).length,
    0,
  );
  const [{ status }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  const [{ count }] = await sql`select count(*)::int as count from inventory_movements where reservation_id = ${reservationId} and movement_type = 'release'`;
  results.a3_concurrentWorkersOneLogicalRelease =
    fulfilled.length === 50 && status === "released" && totalReleased === 1 && Number(count) === 1;
}

// ---------- A4/A9: PAID vs expiration racing the SAME reservation -> exactly one wins, state stays internally consistent, never a mix ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeReservation(7, { expiresInPastMinutes: 5, withPaymentAttempt: true });
  await claimAndAttach(attemptId, attemptVersion, ref("REF-A4"));

  const [paidOutcome, reclaimOutcome] = await Promise.allSettled([
    sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-a4")},'approved','paid')`,
    reclaim(),
  ]);
  const [{ status: attemptStatus }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;

  // Both calls always succeed (releasing/confirming an already-non-active
  // reservation is a safe no-op, never an error) -- the race is decided by
  // row-lock ordering, not by either call failing.
  const consistent =
    (attemptStatus === "paid" && orderStatus === "confirmed" && reservationStatus === "confirmed") ||
    (attemptStatus === "paid" && orderStatus === "confirmed" && reservationStatus === "released");
  results.a4_a9_paidVsExpirationRaceConsistent =
    paidOutcome.status === "fulfilled" && reclaimOutcome.status === "fulfilled" && consistent;

  // Whichever way it landed, re-running reclaim afterwards must be a pure
  // no-op (an already-confirmed OR already-released reservation is never a
  // candidate again).
  const secondBatch = await reclaim();
  results.a4_replayAfterRaceIsNoOp = !secondBatch.some((r) => r.reservation_id === reservationId);
}

// ---------- A5: expiration wins BEFORE a later legitimate PAID arrives -> documented convergence, no crash, order still confirms with zero reservations confirmed ----------
{
  const { orderId, reservationId, attemptId, attemptVersion } = await makeReservation(2, { expiresInPastMinutes: 5, withPaymentAttempt: true });
  await claimAndAttach(attemptId, attemptVersion, ref("REF-A5"));

  const reclaimed = await reclaim();
  const reservationReclaimed = reclaimed.some((r) => r.reservation_id === reservationId && r.released);

  let paidThrew = false;
  let paidResult = null;
  try {
    [paidResult] = await sql`select * from apply_verified_payment_transition(${attemptId},'webhook_received',${ref("evt-a5")},'approved','paid')`;
  } catch {
    paidThrew = true;
  }
  const [{ status: reservationStatus }] = await sql`select status from inventory_reservations where id = ${reservationId}`;
  const [{ status: orderStatus }] = await sql`select status from orders where id = ${orderId}`;

  results.a5_expirationThenLatePaidConverges =
    reservationReclaimed && !paidThrew && paidResult?.inventory_confirmed_count === 0 &&
    orderStatus === "confirmed" && reservationStatus === "released";
}

// ---------- A10: high-contention concurrency across many DISTINCT expired reservations -> zero deadlocks ----------
{
  const many = await Promise.all(Array.from({ length: 50 }, () => makeReservation(1, { expiresInPastMinutes: 5 })));
  const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => reclaim(50)));
  const deadlocks = outcomes.filter((o) => o.status === "rejected" && /deadlock/i.test(String(o.reason)));
  const stillActive = await sql`select count(*)::int as count from inventory_reservations where id = any(${many.map((m) => m.reservationId)}) and status = 'active'`;
  results.a10_zeroDeadlocksAcrossHighContention = deadlocks.length === 0 && Number(stillActive[0].count) === 0;
}

// ---------- input validation, exercised for real against the live function ----------
{
  let rejectedZero = false, rejectedOverMax = false;
  try {
    await sql`select * from reclaim_expired_native_reservations(0,'rerc-test')`;
  } catch (error) {
    rejectedZero = /invalid_batch_size/.test(String(error.message ?? error));
  }
  try {
    await sql`select * from reclaim_expired_native_reservations(1001,'rerc-test')`;
  } catch (error) {
    rejectedOverMax = /invalid_batch_size/.test(String(error.message ?? error));
  }
  results.batchSizeValidationEnforced = rejectedZero && rejectedOverMax;
}

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every((value) => value === true);
console.log(JSON.stringify({ ...results, ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
