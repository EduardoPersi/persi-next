import "server-only";

import { sql } from "drizzle-orm";
import { withPersiRole } from "./nativeCommerceAuthority";

// B.3-D payment ledger foundation -- thin, typed wrappers over the
// SECURITY DEFINER functions in
// supabase/migrations/20260920000000_native_payment_ledger_foundation.sql.
// Nothing here calls a payment provider. Gateway reanchoring (having
// services/payments/{inter,mercadopago,pagbank} actually call these
// functions instead of writing to WooCommerce orders) is a separate,
// future phase -- this module exists so that phase has a stable, typed
// contract to target, not so it can start early.
//
// Every function below runs as persi_worker (via withPersiRole -- see
// lib/db/nativeCommerceAuthority.ts and docs/database/88): every SQL
// function it calls is granted to persi_worker (several exclusively so --
// transition_native_payment_attempt, record_native_payment_event,
// transition_native_refund, apply_verified_payment_transition,
// reclaim_expired_native_reservations). create_native_payment_attempt and
// create_native_refund are dual-granted (persi_app or persi_worker); they
// run as persi_worker here for locality with the worker-only calls
// immediately adjacent to them in every real call site
// (services/checkout/nativeCheckoutService.ts, the three native gateway
// adapters).

export type PaymentProvider = "banco_inter" | "mercado_pago" | "pagbank";
export type PaymentMethod = "pix" | "boleto" | "credit_card" | "apple_pay" | "google_pay";
export type PaymentAttemptStatus = "created" | "pending" | "authorized" | "paid" | "failed" | "cancelled" | "expired" | "refunded" | "partially_refunded";
export type PaymentEventType = "status_observed" | "webhook_received" | "reconciliation_probe" | "manual_override";
export type PaymentEventProcessingResult = "applied" | "duplicate_ignored" | "stale_ignored" | "rejected";
export type RefundStatus = "requested" | "processing" | "completed" | "failed" | "cancelled";

export interface NativePaymentAttempt {
  [key: string]: unknown;
  id: string; orderId: string; provider: PaymentProvider; method: PaymentMethod; status: PaymentAttemptStatus;
  amountMinor: bigint; currency: string; idempotencyKey: string; providerReference: string | null; providerStatus: string | null;
  failureCode: string | null; failureReason: string | null; version: bigint;
}

export interface NativePaymentEvent {
  [key: string]: unknown;
  id: string; paymentAttemptId: string; provider: PaymentProvider; eventType: PaymentEventType;
  externalEventId: string | null; observedStatus: string | null; resultingAttemptStatus: PaymentAttemptStatus | null;
  processingResult: PaymentEventProcessingResult;
}

export interface NativeRefund {
  [key: string]: unknown;
  id: string; paymentAttemptId: string; orderId: string; provider: PaymentProvider;
  requestedAmountMinor: bigint; currency: string; status: RefundStatus; idempotencyKey: string; providerReference: string | null;
}

/** Idempotent by (provider, idempotencyKey): a retried call with the same
 * key always returns the SAME logical attempt, never creates a second one. */
export async function createNativePaymentAttempt(input: { orderId: string; provider: PaymentProvider; method: PaymentMethod; amountMinor: bigint; currency: string; idempotencyKey: string; expiresAt?: Date | null }): Promise<NativePaymentAttempt> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<NativePaymentAttempt>(sql`
    select id::text as "id", order_id::text as "orderId", provider, method, status, amount_minor as "amountMinor", currency,
      idempotency_key as "idempotencyKey", provider_reference as "providerReference", provider_status as "providerStatus",
      failure_code as "failureCode", failure_reason as "failureReason", version
    from public.create_native_payment_attempt(${input.orderId}::uuid, ${input.provider}::public.payment_provider, ${input.method}::public.payment_method, ${input.amountMinor}::bigint, ${input.currency}::char(3), ${input.idempotencyKey}::text, ${input.expiresAt ?? null}::timestamptz)
  `));
  return rows[0];
}

/** Optimistic-concurrency transition -- a stale (expected, expectedVersion)
 * pair fails deterministically (never silently overwrites a newer state). */
export async function transitionNativePaymentAttempt(input: { attemptId: string; expected: PaymentAttemptStatus; target: PaymentAttemptStatus; expectedVersion: bigint; providerReference?: string | null; providerStatus?: string | null; failureCode?: string | null; failureReason?: string | null }): Promise<NativePaymentAttempt> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<NativePaymentAttempt>(sql`
    select id::text as "id", order_id::text as "orderId", provider, method, status, amount_minor as "amountMinor", currency,
      idempotency_key as "idempotencyKey", provider_reference as "providerReference", provider_status as "providerStatus",
      failure_code as "failureCode", failure_reason as "failureReason", version
    from public.transition_native_payment_attempt(${input.attemptId}::uuid, ${input.expected}::public.payment_attempt_status, ${input.target}::public.payment_attempt_status, ${input.expectedVersion}::bigint, ${input.providerReference ?? null}::text, ${input.providerStatus ?? null}::text, ${input.failureCode ?? null}::text, ${input.failureReason ?? null}::text)
  `));
  return rows[0];
}

/** Dedupes on (provider, externalEventId) when present -- the SAME
 * provider event delivered N times returns the SAME row, never inserts twice.
 * Never trusts the caller's observed status as authority by itself: passing
 * resultingStatus only ever ADVANCES the attempt along the valid state
 * machine (lib/db/nativePayment.ts's own transitionNativePaymentAttempt
 * rules apply identically here); anything else is recorded for audit as
 * 'stale_ignored', never applied. */
export async function recordNativePaymentEvent(input: { attemptId: string; provider: PaymentProvider; eventType: PaymentEventType; externalEventId?: string | null; observedStatus?: string | null; resultingStatus?: PaymentAttemptStatus | null; payloadDigest?: string | null }): Promise<NativePaymentEvent> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<NativePaymentEvent>(sql`
    select id::text as "id", payment_attempt_id::text as "paymentAttemptId", provider, event_type as "eventType",
      external_event_id as "externalEventId", observed_status as "observedStatus", resulting_attempt_status as "resultingAttemptStatus", processing_result as "processingResult"
    from public.record_native_payment_event(${input.attemptId}::uuid, ${input.provider}::public.payment_provider, ${input.eventType}::public.payment_event_type, ${input.externalEventId ?? null}::text, ${input.observedStatus ?? null}::text, ${input.resultingStatus ?? null}::public.payment_attempt_status, ${input.payloadDigest ?? null}::text)
  `));
  return rows[0];
}

/** Idempotent by (provider, idempotencyKey), same pattern as
 * createNativePaymentAttempt. Enforces (via a database trigger, not just
 * here) that the sum of non-failed/non-cancelled refunds for one attempt
 * never exceeds that attempt's own amount. */
export async function createNativeRefund(input: { paymentAttemptId: string; orderId: string; provider: PaymentProvider; requestedAmountMinor: bigint; currency: string; idempotencyKey: string; reason?: string | null }): Promise<NativeRefund> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<NativeRefund>(sql`
    select id::text as "id", payment_attempt_id::text as "paymentAttemptId", order_id::text as "orderId", provider,
      requested_amount_minor as "requestedAmountMinor", currency, status, idempotency_key as "idempotencyKey", provider_reference as "providerReference"
    from public.create_native_refund(${input.paymentAttemptId}::uuid, ${input.orderId}::uuid, ${input.provider}::public.payment_provider, ${input.requestedAmountMinor}::bigint, ${input.currency}::char(3), ${input.idempotencyKey}::text, ${input.reason ?? null}::text)
  `));
  return rows[0];
}

export interface VerifiedPaymentTransitionResult {
  [key: string]: unknown;
  paymentAttemptId: string; paymentStatus: PaymentAttemptStatus; paymentVersion: bigint;
  paymentEventId: string; paymentEventProcessingResult: PaymentEventProcessingResult;
  orderId: string; orderStatus: "pending" | "confirmed" | "cancelled" | "completed"; orderTransitioned: boolean;
  inventoryConfirmedCount: number; inventoryReleasedCount: number;
}

/** B.3-H shared, provider-neutral orchestration (supabase/migrations/
 * 20260921000000_shared_payment_order_inventory_orchestration.sql):
 * verified payment status -> payment ledger transition -> native order
 * transition -> inventory reservation confirm/release, applied atomically.
 * Which order/reservations are affected is derived entirely from the
 * attempt's own order_id -- never chosen by the caller. persi_worker only.
 * Every provider adapter's "apply a verified status" call site (initial
 * creation-time status, webhook, reconciliation) should call this instead
 * of recordNativePaymentEvent directly, so the order/inventory consequence
 * is never skipped for a verified terminal outcome. */
export async function applyVerifiedPaymentTransition(input: { attemptId: string; eventType: PaymentEventType; externalEventId?: string | null; observedStatus?: string | null; resultingStatus?: PaymentAttemptStatus | null; payloadDigest?: string | null }): Promise<VerifiedPaymentTransitionResult> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<VerifiedPaymentTransitionResult>(sql`
    select payment_attempt_id::text as "paymentAttemptId", payment_status as "paymentStatus", payment_version as "paymentVersion",
      payment_event_id::text as "paymentEventId", payment_event_processing_result as "paymentEventProcessingResult",
      order_id::text as "orderId", order_status as "orderStatus", order_transitioned as "orderTransitioned",
      inventory_confirmed_count as "inventoryConfirmedCount", inventory_released_count as "inventoryReleasedCount"
    from public.apply_verified_payment_transition(${input.attemptId}::uuid, ${input.eventType}::public.payment_event_type, ${input.externalEventId ?? null}::text, ${input.observedStatus ?? null}::text, ${input.resultingStatus ?? null}::public.payment_attempt_status, ${input.payloadDigest ?? null}::text)
  `));
  return rows[0];
}

export async function transitionNativeRefund(input: { refundId: string; expected: RefundStatus; target: RefundStatus; providerReference?: string | null }): Promise<NativeRefund> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<NativeRefund>(sql`
    select id::text as "id", payment_attempt_id::text as "paymentAttemptId", order_id::text as "orderId", provider,
      requested_amount_minor as "requestedAmountMinor", currency, status, idempotency_key as "idempotencyKey", provider_reference as "providerReference"
    from public.transition_native_refund(${input.refundId}::uuid, ${input.expected}::public.refund_status, ${input.target}::public.refund_status, ${input.providerReference ?? null}::text)
  `));
  return rows[0];
}

export interface NativePaymentAttemptLookup {
  [key: string]: unknown;
  id: string; provider: PaymentProvider; method: PaymentMethod; status: PaymentAttemptStatus; providerReference: string | null;
}

/** ACCELERATED-D: the one lookup a native webhook/reconciliation entrypoint
 * needs that no round before this one built -- given a provider-scoped
 * charge/payment reference (the ONLY thing extracted from a webhook body,
 * same "never trust the payload's status" principle as the legacy webhook
 * routes), find which payment_attempt it belongs to. Returns null rather
 * than throwing when nothing matches (an unknown/stale reference is not an
 * error -- the caller decides what a miss means). */
export async function findNativePaymentAttemptByProviderReference(provider: PaymentProvider, providerReference: string): Promise<NativePaymentAttemptLookup | null> {
  const rows = await withPersiRole("persi_worker", (db) => db.execute<NativePaymentAttemptLookup>(sql`
    select id::text as "id", provider, method, status, provider_reference as "providerReference"
    from public.payment_attempts
    where provider = ${provider}::public.payment_provider and provider_reference = ${providerReference}::text
    limit 1
  `));
  return rows[0] ?? null;
}

export interface StaleNativePaymentAttempt {
  [key: string]: unknown;
  id: string; provider: PaymentProvider; method: PaymentMethod; providerReference: string;
}

/** ACCELERATED-D: bounded read for a future reconciliation worker --
 * attempts stuck in a non-terminal state whose provider reference exists
 * (so there is something to re-query) and haven't been touched recently.
 * Read-only; the actual reconciliation call (which DOES mutate, via
 * apply_verified_payment_transition) is the caller's job, one attempt at a
 * time, so a failure on one attempt never blocks the rest of the batch. */
export async function listStaleNativePendingPaymentAttempts(olderThanMs: number, batchSize = 50): Promise<StaleNativePaymentAttempt[]> {
  const olderThanSeconds = Math.max(0, Math.floor(olderThanMs / 1000));
  return withPersiRole("persi_worker", (db) => db.execute<StaleNativePaymentAttempt>(sql`
    select id::text as "id", provider, method, provider_reference as "providerReference"
    from public.payment_attempts
    where status in ('pending', 'authorized')
      and provider_reference is not null
      and updated_at <= now() - make_interval(secs => ${olderThanSeconds})
    order by updated_at
    limit ${batchSize}
  `));
}

export type InventoryReservationStatus = "active" | "released" | "confirmed" | "expired" | "cancelled";

export interface ReclaimedNativeReservation {
  [key: string]: unknown;
  reservationId: string; reservationStatus: InventoryReservationStatus; released: boolean;
}

/** ACCELERATED-A pending reservation expiration/recovery (supabase/migrations/
 * 20260922000000_native_reservation_expiration_recovery.sql): a bounded,
 * SKIP LOCKED batch reclaim of inventory_reservations past their own
 * expires_at, reusing release_inventory_reservation unchanged. Idempotent --
 * a reservation already non-'active' (released, confirmed, or otherwise
 * terminal) is never a candidate, regardless of how far past its expires_at
 * it is. persi_worker only. Not wired to any scheduler yet; callable ahead of
 * one being authorized (see lib/commerce/reservationExpirationWorker.ts for
 * the bounded-loop shape a future cron would drive). */
export async function reclaimExpiredNativeReservations(batchSize = 100, actor = "reservation_expiration_worker"): Promise<ReclaimedNativeReservation[]> {
  return withPersiRole("persi_worker", (db) => db.execute<ReclaimedNativeReservation>(sql`
    select reservation_id::text as "reservationId", reservation_status as "reservationStatus", released
    from public.reclaim_expired_native_reservations(${batchSize}::integer, ${actor}::text)
  `));
}
