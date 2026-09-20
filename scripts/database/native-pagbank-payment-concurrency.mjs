// B.3-G — NATIVE PagBank (Apple Pay + Google Pay) reanchoring. Real
// Postgres, real concurrent connections. Proves the properties specific to
// services/payments/pagbank/nativeAdapter.ts's own orchestration (Section
// 21 A-F; G is skipped — no refund/cancel capability exists in the legacy
// PagBank integration to reuse, see docs/database/77 section 9). No
// provider is called anywhere in this file. Apple Pay and Google Pay share
// the exact same call sequence in the adapter (a verified audit finding,
// not an assumption — see docs/database/77 section 1), so this harness
// exercises both method values to prove the ledger treats them as
// independent logical attempts, never conflating one wallet's idempotency
// key with the other's.
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
    await tx`insert into stores(id,code,name,status) values(${storeId},${`pbc-${tag}`},'PagBank Concurrency','active')`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},1,${`PBC-${tag}`},'BRL',${amountMinor},${amountMinor},'Concurrency Test','concurrency@example.invalid',${randomUUID()})`;
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
  });
  return { storeId, orderId };
}

async function claim(attemptId, expectedVersion) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'created','pending',${expectedVersion})`;
  return row;
}
async function attachReference(attemptId, expectedVersion, reference, status) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'pending','pending',${expectedVersion},${reference},${status})`;
  return row;
}

// ---------- A: duplicate Apple Pay create, same idempotency key -> one logical attempt/provider invocation ----------
{
  const { orderId } = await withStoreAndOrder(4200n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [a, b] = await Promise.all([
    sql`select * from create_native_payment_attempt(${orderId},'pagbank','apple_pay',4200,'BRL',${idempotencyKey})`,
    sql`select * from create_native_payment_attempt(${orderId},'pagbank','apple_pay',4200,'BRL',${idempotencyKey})`,
  ]);
  const [{ id: attemptId, version }] = a;
  const outcomes = await Promise.allSettled([claim(attemptId, version), claim(attemptId, version)]);
  const claimed = outcomes.filter((o) => o.status === "fulfilled");
  const lost = outcomes.filter((o) => o.status === "rejected");
  const [{ count: rowCount }] = await sql`select count(*)::int count from payment_attempts where idempotency_key = ${idempotencyKey}`;
  results.duplicateApplePayCreateOneLogicalAttempt =
    a[0].id === b[0].id && rowCount === 1 && claimed.length === 1 && lost.length === 1 && /stale_payment_attempt_transition/.test(String(lost[0].reason));
}

// ---------- B: duplicate Google Pay create, same idempotency key -> one logical attempt/provider invocation ----------
{
  const { orderId } = await withStoreAndOrder(3900n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [a, b] = await Promise.all([
    sql`select * from create_native_payment_attempt(${orderId},'pagbank','google_pay',3900,'BRL',${idempotencyKey})`,
    sql`select * from create_native_payment_attempt(${orderId},'pagbank','google_pay',3900,'BRL',${idempotencyKey})`,
  ]);
  const [{ id: attemptId, version }] = a;
  const outcomes = await Promise.allSettled([claim(attemptId, version), claim(attemptId, version)]);
  const claimed = outcomes.filter((o) => o.status === "fulfilled");
  const lost = outcomes.filter((o) => o.status === "rejected");
  const [{ count: rowCount }] = await sql`select count(*)::int count from payment_attempts where idempotency_key = ${idempotencyKey}`;
  results.duplicateGooglePayCreateOneLogicalAttempt =
    a[0].id === b[0].id && rowCount === 1 && claimed.length === 1 && lost.length === 1 && /stale_payment_attempt_transition/.test(String(lost[0].reason));
}

// ---------- C: duplicate webhook -> one effect ----------
{
  const { orderId } = await withStoreAndOrder(2400n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'pagbank','apple_pay',2400,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `PB-C-${randomUUID()}`, "IN_ANALYSIS");
  const externalEventId = `evt-${randomUUID()}`;
  const [e1, e2, e3] = await Promise.all([
    sql`select * from record_native_payment_event(${attemptId},'pagbank','webhook_received',${externalEventId},'PAID','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'pagbank','webhook_received',${externalEventId},'PAID','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'pagbank','webhook_received',${externalEventId},'PAID','paid')`,
  ]);
  const [{ count: eventRowCount }] = await sql`select count(*)::int count from payment_events where external_event_id = ${externalEventId}`;
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  results.duplicateWebhookOneEffect = e1[0].id === e2[0].id && e2[0].id === e3[0].id && eventRowCount === 1 && status === "paid";
}

// ---------- D: webhook + reconciliation concurrently -> deterministic final state ----------
{
  const { orderId } = await withStoreAndOrder(1900n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'pagbank','google_pay',1900,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `PB-D-${randomUUID()}`, "IN_ANALYSIS");
  await Promise.all([
    sql`select * from record_native_payment_event(${attemptId},'pagbank','webhook_received',${`evt-${randomUUID()}`},'PAID','paid')`,
    sql`select * from record_native_payment_event(${attemptId},'pagbank','reconciliation_probe',null,'PAID','paid')`,
  ]);
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  const [{ count: eventCount }] = await sql`select count(*)::int count from payment_events where payment_attempt_id = ${attemptId}`;
  results.webhookAndReconciliationDeterministic = status === "paid" && eventCount === 2;
}

// ---------- E: stale transition never regresses newer state ----------
{
  const { orderId } = await withStoreAndOrder(2700n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'pagbank','apple_pay',2700,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  const withRef = await attachReference(attemptId, claimed.version, `PB-E-${randomUUID()}`, "AUTHORIZED");
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
  const { orderId } = await withStoreAndOrder(3300n);
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'pagbank','google_pay',3300,'BRL',${`idem-${randomUUID()}`})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `PB-F-${randomUUID()}`, "IN_ANALYSIS");
  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      sql`select * from record_native_payment_event(${attemptId},'pagbank','webhook_received',${`race-evt-${index}`},'PAID','paid')`
    ),
  );
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const [{ status, version: finalVersion }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  results.concurrentPaidTransitionOneLogicalState = fulfilled.length === 10 && status === "paid" && Number(finalVersion) === 3;
}

// G (duplicate refund) intentionally skipped: no refund/cancel capability
// exists in the legacy PagBank integration to model — see
// docs/database/77 section 9 (PAGBANK_REFUND_CAPABILITY =
// PAGBANK_CANCEL_CAPABILITY = NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION).

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every(Boolean);
console.log(JSON.stringify({ ...results, refundDuplicateSkippedReason: "NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION", ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
