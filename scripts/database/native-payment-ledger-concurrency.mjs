// B.3-D payment ledger concurrency/idempotency harness. Real Postgres, real
// concurrent connections -- proves the 6 properties Phase 2 (Section 17)
// requires. Runs against the LOCAL canonical database (127.0.0.1:15422)
// this round's own fresh bootstrap already qualified -- no disposable
// container needed for this narrower, single-domain proof (unlike the
// full E1/E2 adversarial-role harnesses from the prior E2 requalification).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const sql = postgres(localDatabaseUrl(), { max: 20, prepare: false });
const results = {};

async function withStoreAndOrder(amountMinor) {
  const storeId = randomUUID(), orderId = randomUUID(), tag = randomUUID().slice(0, 8);
  await sql.begin(async (tx) => {
    await tx`insert into stores(id,code,name,status) values(${storeId},${`pc-${tag}`},'Payment Concurrency','active')`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},1,${`PC-${tag}`},'BRL',${amountMinor},${amountMinor},'Concurrency Test','concurrency@example.invalid',${randomUUID()})`;
    // orders_initial_event_required is a DEFERRED constraint trigger --
    // this row must exist before the transaction commits.
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
  });
  return { storeId, orderId };
}

// ---------- A: two concurrent creations, same idempotency key -> one logical attempt ----------
{
  const { orderId } = await withStoreAndOrder(1000n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [a, b] = await Promise.all([
    sql`select * from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',1000,'BRL',${idempotencyKey})`,
    sql`select * from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',1000,'BRL',${idempotencyKey})`,
  ]);
  const [{ count: rowCount }] = await sql`select count(*)::int count from payment_attempts where idempotency_key = ${idempotencyKey}`;
  results.sameIdempotencyKeySameAttempt = a[0].id === b[0].id && rowCount === 1;
}

// ---------- B: duplicate webhook/event -> one logical effect ----------
{
  const { orderId } = await withStoreAndOrder(2000n);
  const [{ id: attemptId }] = await sql`select id from create_native_payment_attempt(${orderId},'banco_inter','pix',2000,'BRL',${`idem-${randomUUID()}`})`;
  await sql`select transition_native_payment_attempt(${attemptId},'created','pending',0)`;
  const externalEventId = `evt-${randomUUID()}`;
  const [e1, e2, e3] = await Promise.all([
    sql`select * from record_native_payment_event(${attemptId},'banco_inter','webhook_received',${externalEventId},'paid','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'banco_inter','webhook_received',${externalEventId},'paid','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'banco_inter','webhook_received',${externalEventId},'paid','paid')`,
  ]);
  const [{ count: eventRowCount }] = await sql`select count(*)::int count from payment_events where external_event_id = ${externalEventId}`;
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  results.duplicateWebhookOneEffect = e1[0].id === e2[0].id && e2[0].id === e3[0].id && eventRowCount === 1 && status === "paid";
}

// ---------- C: concurrent reconciliation probe + webhook -> consistent state ----------
{
  const { orderId } = await withStoreAndOrder(1500n);
  const [{ id: attemptId }] = await sql`select id from create_native_payment_attempt(${orderId},'pagbank','google_pay',1500,'BRL',${`idem-${randomUUID()}`})`;
  await sql`select transition_native_payment_attempt(${attemptId},'created','pending',0)`;
  const webhookEventId = `evt-${randomUUID()}`;
  await Promise.all([
    sql`select * from record_native_payment_event(${attemptId},'pagbank','webhook_received',${webhookEventId},'paid','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'pagbank','reconciliation_probe',null,'paid','paid')`,
  ]);
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ count: eventCount }] = await sql`select count(*)::int count from payment_events where payment_attempt_id = ${attemptId}`;
  // Both a webhook delivery and an independent reconciliation probe agreeing
  // the attempt is "paid" must converge on exactly one 'paid' attempt and
  // exactly 2 event rows (one per distinct event -- webhook has an
  // external_event_id, the probe does not, so they never dedupe against
  // each other, by design).
  results.concurrentReconciliationConsistent = status === "paid" && eventCount === 2;
}

// ---------- D: duplicate refund request -> one logical refund ----------
{
  const { orderId } = await withStoreAndOrder(4000n);
  const [{ id: attemptId }] = await sql`select id from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',4000,'BRL',${`idem-${randomUUID()}`})`;
  await sql`select transition_native_payment_attempt(${attemptId},'created','pending',0)`;
  await sql`select transition_native_payment_attempt(${attemptId},'pending','paid',1)`;
  const refundIdempotencyKey = `refund-idem-${randomUUID()}`;
  const [r1, r2] = await Promise.all([
    sql`select * from create_native_refund(${attemptId},${orderId},'mercado_pago',1000,'BRL',${refundIdempotencyKey})`,
    sql`select * from create_native_refund(${attemptId},${orderId},'mercado_pago',1000,'BRL',${refundIdempotencyKey})`,
  ]);
  const [{ count: refundRowCount }] = await sql`select count(*)::int count from refunds where idempotency_key = ${refundIdempotencyKey}`;
  results.duplicateRefundOneLogicalRefund = r1[0].id === r2[0].id && refundRowCount === 1;
}

// ---------- E: stale transition never overwrites newer state ----------
{
  const { orderId } = await withStoreAndOrder(2500n);
  const [{ id: attemptId }] = await sql`select id from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',2500,'BRL',${`idem-${randomUUID()}`})`;
  await sql`select transition_native_payment_attempt(${attemptId},'created','pending',0)`;
  await sql`select transition_native_payment_attempt(${attemptId},'pending','authorized',1)`;
  // A caller still holding the STALE (pending, version 1) view races a
  // caller with the CURRENT (authorized, version 2) view. The stale one
  // must be rejected (40001), never silently applied on top of the newer
  // state.
  const [staleResult, freshResult] = await Promise.allSettled([
    sql`select transition_native_payment_attempt(${attemptId},'pending','failed',1,null,null,'stale_actor','should never apply')`,
    sql`select transition_native_payment_attempt(${attemptId},'authorized','paid',2)`,
  ]);
  const [{ status, version }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  results.staleTransitionNeverOverwrites = staleResult.status === "rejected" && /stale_payment_attempt_transition/.test(String(staleResult.reason)) && freshResult.status === "fulfilled" && status === "paid" && Number(version) === 3;
}

// ---------- F: no race creates "paid" twice (concurrent event delivery + explicit transition both targeting paid) ----------
{
  const { orderId } = await withStoreAndOrder(3200n);
  const [{ id: attemptId }] = await sql`select id from create_native_payment_attempt(${orderId},'banco_inter','boleto',3200,'BRL',${`idem-${randomUUID()}`})`;
  await sql`select transition_native_payment_attempt(${attemptId},'created','pending',0)`;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      sql`select * from record_native_payment_event(${attemptId},'banco_inter','webhook_received',${`race-evt-${index}`},'paid','paid')`
    ),
  );
  const fulfilled = outcomes.filter((item) => item.status === "fulfilled");
  const [{ status, version }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  // 10 distinct (different external_event_id) concurrent deliveries, all
  // legitimately trying to move pending->paid -- exactly ONE of them may
  // perform the actual state transition (version increments exactly once
  // from pending's version); the rest must observe the attempt ALREADY
  // paid and record their event as 'applied' (same target status, a no-op
  // transition) WITHOUT incrementing version again.
  results.noRaceCreatesPaidTwice = fulfilled.length === 10 && status === "paid" && Number(version) === 2;
}

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every(Boolean);
console.log(JSON.stringify({ ...results, ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
