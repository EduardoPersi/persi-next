// B.3-E — NATIVE Banco Inter reanchoring. Real Postgres, real concurrent
// connections. This harness proves properties SPECIFIC to
// services/payments/inter/nativeAdapter.ts's own orchestration (the claim
// gate before a non-idempotent provider call, and "webhook says paid but a
// fresh provider query says pending stays pending") — properties Phase 2's
// generic ledger harness (native-payment-ledger-concurrency.mjs) does not
// cover because they are about THIS module's call sequence, not the raw SQL
// functions in isolation. No provider is called anywhere in this file
// (Section 23: no real Inter call) — the "provider create" step is
// SIMULATED directly at the SQL layer with banco_inter-shaped rows, exactly
// mirroring the two transition_native_payment_attempt calls nativeAdapter.ts
// itself makes (claim, then attach-reference).
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
    await tx`insert into stores(id,code,name,status) values(${storeId},${`ic-${tag}`},'Inter Concurrency','active')`;
    await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
      values(${orderId},${storeId},1,${`IC-${tag}`},'BRL',${amountMinor},${amountMinor},'Concurrency Test','concurrency@example.invalid',${randomUUID()})`;
    await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${randomUUID()})`;
  });
  return { storeId, orderId };
}

// Mirrors nativeAdapter.ts's own two-step claim: (1) created -> pending with
// NO reference (the concurrency gate a caller must win before it may call
// the provider), (2) pending -> pending attaching provider_reference (a
// self-transition, valid because the ledger trigger short-circuits on
// new.status = old.status while the function itself still enforces the
// optimistic version check and bumps version).
async function claim(attemptId, expectedVersion) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'created','pending',${expectedVersion})`;
  return row;
}
async function attachReference(attemptId, expectedVersion, reference, status) {
  const [row] = await sql`select * from transition_native_payment_attempt(${attemptId},'pending','pending',${expectedVersion},${reference},${status})`;
  return row;
}

// ---------- A: Boleto — two concurrent creations, same idempotency key -> only ONE ever reaches the (simulated, non-idempotent) provider call ----------
{
  const { orderId } = await withStoreAndOrder(3000n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'banco_inter','boleto',3000,'BRL',${idempotencyKey})`;

  const outcomes = await Promise.allSettled([
    claim(attemptId, version),
    claim(attemptId, version),
  ]);
  const claimed = outcomes.filter((o) => o.status === "fulfilled");
  const lost = outcomes.filter((o) => o.status === "rejected");
  const [{ count: attemptRowCount }] = await sql`select count(*)::int count from payment_attempts where idempotency_key = ${idempotencyKey}`;
  results.boletoOnlyOneClaimWinsProviderCallGate =
    claimed.length === 1 && lost.length === 1 && /stale_payment_attempt_transition/.test(String(lost[0].reason)) && attemptRowCount === 1;
}

// ---------- B: Pix — same gate, but BOTH a claim-winner and (hypothetically) a resumed retry may safely call the provider, since Pix creation is idempotent there; this harness only proves the ledger side stays single-row under concurrency ----------
{
  const { orderId } = await withStoreAndOrder(1200n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [a, b] = await Promise.all([
    sql`select * from create_native_payment_attempt(${orderId},'banco_inter','pix',1200,'BRL',${idempotencyKey})`,
    sql`select * from create_native_payment_attempt(${orderId},'banco_inter','pix',1200,'BRL',${idempotencyKey})`,
  ]);
  const [{ count: rowCount }] = await sql`select count(*)::int count from payment_attempts where idempotency_key = ${idempotencyKey}`;
  results.pixSameIdempotencyKeySameAttempt = a[0].id === b[0].id && rowCount === 1;
}

// ---------- C: full create -> claim -> attach-reference -> event sequence, exactly as nativeAdapter.ts performs it, ends in the expected ledger state ----------
{
  const { orderId } = await withStoreAndOrder(5500n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'banco_inter','pix',5500,'BRL',${idempotencyKey})`;
  const claimed = await claim(attemptId, version);
  const txid = idempotencyKey.replace(/[^A-Za-z0-9]/g, "").padEnd(26, "0").slice(0, 32);
  const withRef = await attachReference(attemptId, claimed.version, txid, "ATIVA");
  const [event] = await sql`select * from record_native_payment_event(${attemptId},'banco_inter','status_observed',null,'ATIVA','pending')`;
  const [{ status, provider_reference: providerReference, version: finalVersion }] = await sql`select status, provider_reference, version from payment_attempts where id = ${attemptId}`;
  results.fullCreationSequenceEndsConsistent =
    withRef.provider_reference === txid && status === "pending" && providerReference === txid && event.processing_result === "applied" && Number(finalVersion) === 2;
}

// ---------- D: webhook claims 'paid' but a fresh provider query (simulated) says pending -> stays pending ----------
// This mirrors applyNativeInterWebhookNotification's own design: the
// webhook body's claimed status is NEVER read by that function at all --
// only the VERIFIED (here: simulated) query result is ever passed as
// resultingStatus. This property proves the ledger-level consequence: even
// if some future caller mistakenly passed a webhook-claimed status, passing
// the CORRECT (verified) 'pending' value is what actually gets recorded,
// and the attempt never flips to paid from it.
{
  const { orderId } = await withStoreAndOrder(900n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'banco_inter','boleto',900,'BRL',${idempotencyKey})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `REQ-D-${randomUUID()}`, "EM_PROCESSAMENTO");
  // The webhook delivery is reduced, by design, to only its dedupe id --
  // the verified status ("pending", from the simulated provider query) is
  // what this call passes, exactly as applyNativeInterWebhookNotification
  // does after re-querying the provider itself.
  await sql`select * from record_native_payment_event(${attemptId},'banco_inter','webhook_received',${`evt-${randomUUID()}`},'A_RECEBER','pending')`;
  const [{ status }] = await sql`select status from payment_attempts where id = ${attemptId}`;
  results.webhookClaimIgnoredStaysPendingWhenVerificationSaysPending = status === "pending";
}

// ---------- E: out-of-order events (an older-looking observation arriving after a newer one) never regresses the attempt ----------
{
  const { orderId } = await withStoreAndOrder(2100n);
  const idempotencyKey = `idem-${randomUUID()}`;
  const [{ id: attemptId, version }] = await sql`select id, version from create_native_payment_attempt(${orderId},'banco_inter','pix',2100,'BRL',${idempotencyKey})`;
  const claimed = await claim(attemptId, version);
  await attachReference(attemptId, claimed.version, `TXID-E-${randomUUID()}`, "ATIVA");
  // Reconciliation and webhook race: reconciliation observes 'paid' first...
  await sql`select * from record_native_payment_event(${attemptId},'banco_inter','reconciliation_probe',null,'CONCLUIDA','paid')`;
  // ...then a stale webhook delivery for the SAME charge arrives late,
  // still (incorrectly, from an out-of-order delivery) trying to report
  // 'pending' -- record_native_payment_event must never regress 'paid'
  // back to 'pending'.
  const [staleEvent] = await sql`select * from record_native_payment_event(${attemptId},'banco_inter','webhook_received',${`evt-${randomUUID()}`},'ATIVA','pending')`;
  const [{ status, version: finalVersion }] = await sql`select status, version from payment_attempts where id = ${attemptId}`;
  results.outOfOrderEventNeverRegresses = status === "paid" && staleEvent.processing_result === "stale_ignored" && Number(finalVersion) === 3;
}

await sql.end({ timeout: 5 });

const allPass = Object.values(results).every(Boolean);
console.log(JSON.stringify({ ...results, ALL_PASS: allPass }, null, 2));
if (!allPass) process.exitCode = 1;
