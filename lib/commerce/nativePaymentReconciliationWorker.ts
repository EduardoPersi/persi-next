import "server-only";

import { listStaleNativePendingPaymentAttempts, type StaleNativePaymentAttempt } from "@/lib/db/nativePayment";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { reconcileNativeInterPendingAttempt } from "@/services/payments/inter/nativeAdapter";
import { reconcileNativeMercadoPagoPendingAttempt } from "@/services/payments/mercadopago/nativeAdapter";
import { reconcileNativePagBankPendingAttempt } from "@/services/payments/pagbank/nativeAdapter";

// ACCELERATED ROUND — Track D: reconciliation worker foundation.
//
// Bounded-batch loop, same time-budget shape as services/payments/
// cronReconciliation.ts's reconcilePendingOrders and lib/commerce/
// reservationExpirationWorker.ts's processExpiredNativeReservations. No
// scheduler/cron route wired to this in this round -- it exists so one can
// be authorized and wired later without inventing this shape at that time.
//
// Reuses reconcileNative{Inter,MercadoPago,PagBank}PendingAttempt
// unchanged (Inter/Mercado Pago/PagBank gateway rounds, already tested) --
// this file adds no new payment-verification logic, only the batch
// iteration and provider dispatch around calls that already exist.

async function defaultReconcileByProvider(attempt: StaleNativePaymentAttempt): Promise<void> {
  if (attempt.provider === "banco_inter") {
    if (attempt.method !== "pix" && attempt.method !== "boleto") throw new Error("NATIVE_RECONCILIATION_UNEXPECTED_INTER_METHOD");
    await reconcileNativeInterPendingAttempt({ attemptId: attempt.id, method: attempt.method, providerReference: attempt.providerReference });
    return;
  }
  if (attempt.provider === "mercado_pago") {
    await reconcileNativeMercadoPagoPendingAttempt({ attemptId: attempt.id, providerReference: attempt.providerReference });
    return;
  }
  await reconcileNativePagBankPendingAttempt({ attemptId: attempt.id, providerReference: attempt.providerReference });
}

export interface NativePaymentReconciliationSummary {
  batches: number;
  checked: number;
  reconciled: number;
  errors: number;
  truncated: boolean;
  durationMs: number;
}

export interface ProcessNativePendingReconciliationOptions {
  /** How long an attempt must have been untouched before it's a candidate.
   * Default 15 minutes is a starting point, not a tuned value -- staging
   * should set this per the actual margin above each payment method's own
   * provider-side expiry window (see docs/database/80's identical caveat
   * for inventory_reservations.expires_at). */
  staleAfterMs?: number;
  batchSize?: number;
  timeBudgetMs?: number;
  now?: () => number;
  listStale?: typeof listStaleNativePendingPaymentAttempts;
  reconcileByProvider?: (attempt: StaleNativePaymentAttempt) => Promise<void>;
  onAttemptError?: (attempt: StaleNativePaymentAttempt, error: unknown) => void;
}

const DEFAULT_STALE_AFTER_MS = 15 * 60_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_TIME_BUDGET_MS = 20_000;

export async function processNativePendingReconciliation(
  options: ProcessNativePendingReconciliationOptions = {},
): Promise<NativePaymentReconciliationSummary> {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const now = options.now ?? Date.now;
  const listStale = options.listStale ?? listStaleNativePendingPaymentAttempts;
  const reconcileByProvider = options.reconcileByProvider ?? defaultReconcileByProvider;

  const startedAt = now();
  const summary: NativePaymentReconciliationSummary = {
    batches: 0, checked: 0, reconciled: 0, errors: 0, truncated: false, durationMs: 0,
  };

  for (;;) {
    if (now() - startedAt >= timeBudgetMs) {
      summary.truncated = true;
      break;
    }

    const batch = await listStale(staleAfterMs, batchSize);
    summary.batches += 1;
    if (batch.length === 0) break;

    for (const attempt of batch) {
      summary.checked += 1;
      try {
        await reconcileByProvider(attempt);
        summary.reconciled += 1;
      } catch (error) {
        summary.errors += 1;
        options.onAttemptError?.(attempt, error);
      }
    }

    if (batch.length < batchSize) break;
  }

  summary.durationMs = now() - startedAt;
  logNativeCommerceEvent("native_reconciliation_batch_completed", {
    batches: summary.batches,
    checked: summary.checked,
    reconciled: summary.reconciled,
    errors: summary.errors,
    truncated: summary.truncated,
    durationMs: summary.durationMs,
  });
  return summary;
}
