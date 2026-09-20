// B.3-F — NATIVE Mercado Pago (card) reanchoring. Real Postgres, real
// concurrent connections. Proves the properties specific to
// services/payments/mercadopago/nativeAdapter.ts's own orchestration
// (Section 19 A-F; G is skipped — no refund capability exists in the
// legacy Mercado Pago integration to reuse, see docs/database/76 section
// 9). No provider is called anywhere in this file.
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
    await tx`insert into stores(id,code,name,status) values(${storeId},${`mpc-${tag}`},'Mercado Pago Concurrency','active')`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},1,${`MPC-${tag}`},'BRL',${amountMinor},${amountMinor},'Concurrency Test','concurrency@example.invalid',${randomUUID()})`;
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
  });
  return { storeId, orderId };
}

// Mirrors nativeAdapter.ts's own claim step.
async function claim(attemptId, expectedVersion) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'created','pending',${expectedVersion})`;
  return row;
}
async function attachReference(attemptId, expectedVersion, reference, status) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'pending','pending',${expectedVersion},${reference},${status})`;
  return row;
}

// ---------- A: duplicate card create, same idempotency key -> one logical attempt ----------
{
  const { orderId } = await withStoreAndOrder(4000n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [a, b] = await Promise.all([
    sql`select * from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',4000,'BRL',${idempotencyKey})`,
    sql`select * from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',4000,'BRL',${idempotencyKey})`,
  ]);
  const [{ count: rowCount }] = await sql`select count(*)::int count from payment_attempts where idempotency_key = ${idempotencyKey}`;
  results.duplicateCardCreateOneLogicalAttempt = a[0].id === b[0].id && rowCount === 1;
}

// ---------- B: concurrent create -> only ONE wins the claim (one logical provider invocation) ----------
{
  const { orderId } = await withStoreAndOrder(3500n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',3500,'BRL',${idempotencyKey})`;
  const outcomes = await Promise.allSettled([claim(attemptId, version), claim(attemptId, version)]);
  const claimed = outcomes.filter((o) => o.status === "fulfilled");
  const lost = outcomes.filter((o) => o.status === "rejected");
  results.concurrentCreateOneProviderInvocationGate =
    claimed.length === 1 && lost.length === 1 && /stale_payment_attempt_transition/.test(String(lost[0].reason));
}

// ---------- C: duplicate webhook -> one effect ----------
{
  const { orderId } = await withStoreAndOrder(2200n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',2200,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `MP-C-${randomUUID()}`, "in_process");
  const externalEventId = `evt-${randomUUID()}`;
  const [e1, e2, e3] = await Promise.all([
    sql`select * from record_native_payment_event(${attemptId},'mercado_pago','webhook_received',${externalEventId},'approved','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'mercado_pago','webhook_received',${externalEventId},'approved','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'mercado_pago','webhook_received',${externalEventId},'approved','paid')`,
  ]);
  const [{ count: eventRowCount }] = await sql`select count(*)::int count from payment_events where external_event_id = ${externalEventId}`;
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  results.duplicateWebhookOneEffect = e1[0].id === e2[0].id && e2[0].id === e3[0].id && eventRowCount === 1 && status === "paid";
}

// ---------- D: webhook + reconciliation concurrently -> deterministic final state ----------
{
  const { orderId } = await withStoreAndOrder(1800n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',1800,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `MP-D-${randomUUID()}`, "in_process");
  await Promise.all([
    sql`select * from record_native_payment_event(${attemptId},'mercado_pago','webhook_received',${`evt-${randomUUID()}`},'approved','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'mercado_pago','reconciliation_probe',null,'approved','paid')`,
  ]);
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ count: eventCount }] = await sql`select count(*)::int count from payment_events where payment_attempt_id = ${attemptId}`;
  results.webhookAndReconciliationDeterministic = status === "paid" && eventCount === 2;
}

// ---------- E: stale transition never regresses newer state ----------
{
  const { orderId } = await withStoreAndOrder(2600n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',2600,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  const withRef = await attachReference(attemptId, claimed.version, `MP-E-${randomUUID()}`, "authorized");
  await sql`select transition_native_payment_attempt(${attemptId},'pending','authorized',${withRef.version})`;
  const [staleResult, freshResult] = await Promise.allSettled([
    sql`select transition_native_payment_attempt(${attemptId},'authorized','failed',${withRef.version},null,null,'stale_actor','should never apply')`,
    sql`select transition_native_payment_attempt(${attemptId},'authorized','paid',${Number(withRef.version) + 1})`,
  ]);
  const [{ status, version: finalVersion }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  results.staleTransitionNeverRegresses =
    staleResult.status === "rejected" && /stale_payment_attempt_transition/.test(String(staleResult.reason)) &&
    freshResult.status === "fulfilled" && status === "paid" && Number(finalVersion) === Number(withRef.version) + 2;
}

// ---------- F: concurrent paid-transition attempts -> one logical paid state ----------
{
  const { orderId } = await withStoreAndOrder(3100n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',3100,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `MP-F-${randomUUID()}`, "in_process");
  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      sql`select * from record_native_payment_event(${attemptId},'mercado_pago','webhook_received',${`race-evt-${index}`},'approved','paid')`
    ),
  );
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const [{ status, version: finalVersion }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  // version 0 (created) -> 1 (claim: created->pending) -> 2 (attachReference:
  // pending->pending self-transition) -> 3 (exactly one of the 10 concurrent
  // events actually performs pending->paid; the other 9 observe the attempt
  // already paid and record their event as a no-op 'applied' without
  // bumping version again).
  results.concurrentPaidTransitionOneLogicalState = fulfilled.length === 10 && status === "paid" && Number(finalVersion) === 3;
}

// G (duplicate refund) intentionally skipped: no refund capability exists
// in the legacy Mercado Pago integration to model — see
// docs/database/76 section 9 (MP_REFUND_CAPABILITY =
// NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION). Nothing here invents one.

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every(Boolean);
console.log(JSON.stringify({ ...results, refundDuplicateSkippedReason: "NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION", ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
