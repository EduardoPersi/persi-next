import "server-only";

import { reclaimExpiredNativeReservations } from "@/lib/db/nativePayment";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";

// ACCELERATED ROUND — Track A: pending reservation expiration/recovery.
//
// Bounded-batch loop over reclaimExpiredNativeReservations (supabase/
// migrations/20260922000000_native_reservation_expiration_recovery.sql),
// shaped the same way services/payments/cronReconciliation.ts's
// reconcilePendingOrders is: a time budget checked before each batch, never
// starting new work once the budget is spent, so a large backlog degrades to
// `truncated: true` instead of running unbounded inside one process tick.
// No scheduler/cron route is wired to this in this round (see
// docs/database/80) -- it exists so one can be authorized and wired later
// without inventing this shape at that time.

export interface ReservationExpirationSummary {
  batches: number;
  reclaimed: number;
  released: number;
  truncated: boolean;
  durationMs: number;
}

export interface ProcessExpiredNativeReservationsOptions {
  batchSize?: number;
  timeBudgetMs?: number;
  actor?: string;
  now?: () => number;
  reclaim?: typeof reclaimExpiredNativeReservations;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_TIME_BUDGET_MS = 20_000;

export async function processExpiredNativeReservations(
  options: ProcessExpiredNativeReservationsOptions = {},
): Promise<ReservationExpirationSummary> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const actor = options.actor ?? "reservation_expiration_worker";
  const now = options.now ?? Date.now;
  const reclaim = options.reclaim ?? reclaimExpiredNativeReservations;

  const startedAt = now();
  const summary: ReservationExpirationSummary = {
    batches: 0,
    reclaimed: 0,
    released: 0,
    truncated: false,
    durationMs: 0,
  };

  for (;;) {
    if (now() - startedAt >= timeBudgetMs) {
      summary.truncated = true;
      break;
    }

    const batch = await reclaim(batchSize, actor);
    summary.batches += 1;
    summary.reclaimed += batch.length;
    summary.released += batch.filter((row) => row.released).length;

    if (batch.length < batchSize) break;
  }

  summary.durationMs = now() - startedAt;
  logNativeCommerceEvent("native_reservation_expiration_batch_completed", {
    batches: summary.batches,
    reclaimed: summary.reclaimed,
    released: summary.released,
    truncated: summary.truncated,
    durationMs: summary.durationMs,
  });
  return summary;
}
