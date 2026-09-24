import "server-only";

// ACCELERATED ROUND — Track E: minimum native-commerce observability.
//
// Scoped to this round's own new code (Tracks A/C/D) only -- not a retrofit
// of already-qualified legacy-adjacent files, to avoid an unrelated blast
// radius (Section 27: "não misturar grande refatoração com nova
// funcionalidade sem necessidade"). No dashboards, no new dependency: a
// structured console.info/console.error line per event, following the
// "[tag] + object" convention already used everywhere in this codebase
// (app/api/webhooks/*/route.ts, app/api/cron/expire-pending-payments/route.ts,
// services/payments/*/client.ts) -- there is no existing lib/logging module
// to reuse (confirmed by search; see docs/database/87).
//
// The field allow-list (NativeCommerceEventFields) is enforced at the type
// level: it declares no field shaped like a card/wallet token, provider
// secret, certificate, authorization header, or full raw webhook payload,
// so passing one would be a type error, not a runtime redaction step. A
// logging failure must never affect commerce correctness -- every call is
// wrapped so it can only ever fail silently.

export type NativeCommerceEventName =
  | "native_checkout_submission_rejected_runtime_disabled"
  | "native_checkout_submission_failed"
  | "native_checkout_submission_succeeded"
  | "native_reservation_expiration_batch_completed"
  | "native_webhook_received"
  | "native_webhook_reconciliation_applied"
  | "native_webhook_processing_failed"
  | "native_reconciliation_batch_completed"
  // Gate 3 -- new cart/checkout-preparation routes (staging-only, gated by
  // isNativeCommerceStagingRoutesEnabled()). Failure variants use the
  // "_rejected_*"/"_failed" suffix so logNativeCommerceEvent's own
  // isFailure heuristic (name.endsWith) routes them to console.error.
  | "native_cart_created"
  // Emitted instead of native_cart_created whenever POST /api/cart/native
  // returns a pre-existing cart -- either create_native_cart's own first
  // idempotency check found one, or the 2026-09-24 guest-race recovery
  // (findNativeCartByGuestTokenAnyStatus) did. Closes the backlog item
  // from the Gate 3 staging round: "separar created/reused".
  | "native_cart_reused"
  | "native_cart_item_added"
  | "native_cart_item_updated"
  | "native_cart_item_removed"
  | "native_cart_request_rejected_product_not_mapped"
  | "native_checkout_prepared"
  | "native_checkout_prepare_failed"
  | "native_checkout_pii_persisted"
  | "native_checkout_marked_ready"
  // Gate 3 staging smoke test (2026-09-23) -- a business error that no
  // known mapping recognizes (i.e. mapCartError/mapCheckoutError's final
  // fallback). Always logged as an error (see isFailure below), always
  // with `route` + a sanitized `code` (Postgres SQLSTATE or Error.name),
  // never the raw message/payload.
  | "native_commerce_unexpected_error";

export interface NativeCommerceEventFields {
  correlationId?: string;
  route?: string;
  cartId?: string;
  checkoutId?: string;
  orderId?: string;
  paymentAttemptId?: string;
  reservationId?: string;
  provider?: string;
  method?: string;
  status?: string;
  code?: string;
  batches?: number;
  reclaimed?: number;
  released?: number;
  checked?: number;
  reconciled?: number;
  errors?: number;
  truncated?: boolean;
  durationMs?: number;
}

export function logNativeCommerceEvent(name: NativeCommerceEventName, fields: NativeCommerceEventFields = {}): void {
  try {
    const isFailure = name.endsWith("_failed") || name.endsWith("_rejected_runtime_disabled") || name.endsWith("_error");
    if (isFailure) {
      console.error(`[native-commerce] ${name}`, fields);
    } else {
      console.info(`[native-commerce] ${name}`, fields);
    }
  } catch {
    // Never let a logging failure (e.g. a caller accidentally passing a
    // circular structure) propagate into commerce-correctness code paths.
  }
}
