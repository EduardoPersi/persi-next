# 75 — Native Banco Inter Gateway Reanchoring (B.3-E)

Status: **qualified, not live**. Nothing in this round makes a real call to
Banco Inter, activates any runtime path, or touches WooCommerce. This
document, [`services/payments/inter/nativeAdapter.ts`](../../services/payments/inter/nativeAdapter.ts),
[`tests/paymentsInterNativeAdapter.test.mjs`](../../tests/paymentsInterNativeAdapter.test.mjs)
and [`scripts/database/native-inter-payment-concurrency.mjs`](../../scripts/database/native-inter-payment-concurrency.mjs)
are new; every existing Inter/WooCommerce file is untouched (verified by
`git status` — see Section 8).

## 1. Why this exists

[74-native-payment-ledger-foundation.md](74-native-payment-ledger-foundation.md)
built a provider-neutral payment ledger (`payment_attempts`, `payment_events`,
`refunds`) with nothing wired to a real gateway. This round wires the FIRST
provider — Banco Inter (Pix + Boleto) — to that ledger, in parallel with
(never replacing) the existing WooCommerce-anchored Inter integration that
`app/api/checkout/payment/route.ts` still uses today.

## 2. PROVIDER_LOGIC vs WOO_ANCHORING in the existing integration

| File | Classification | Reused as-is? |
|---|---|---|
| `services/payments/inter/client.ts` (mTLS, OAuth2 token cache, `interRequest`) | PROVIDER_LOGIC | Yes, unchanged, imported transitively |
| `services/payments/inter/pix.ts` (`createPixCharge`, `getPixCharge`, `getPixChargeStatus`, `isPixChargeExpired`) | PROVIDER_LOGIC | Yes, unchanged, called directly |
| `services/payments/inter/boleto.ts` (`createBoletoCharge`, `getBoletoChargeStatus`, `getBoletoPdfBase64`) | PROVIDER_LOGIC | Yes, unchanged, called directly |
| `services/payments/inter/errors.ts` (`InterPaymentError`) | PROVIDER_LOGIC | Yes, unchanged |
| `services/payments/gateway.ts` (`interPaymentGateway` adapter shape) | WOO_ANCHORING (its only two callers are the legacy checkout route) | Not reused — replaced conceptually by `nativeAdapter.ts`'s own functions |
| `app/api/checkout/payment/route.ts` (`txid: input.idempotencyKey…`, `seuNumero: String(order.id)`) | WOO_ANCHORING (`seuNumero` derives from the **Woo** order id) | Not reused for the native path — see Section 3 |
| `services/woocommerce/orders.ts` (`createPendingOrder`, `attachPaymentReference`, `markOrderAsPaid`, `markOrderAsFailed`, `findOrderByPaymentReference`) | WOO_ANCHORING | Not called by anything in this round |
| `services/payments/reconcile.ts` (`categorizePixStatus`, `categorizeBoletoStatus`, `reconcilePaymentReference`) | Mixed — the categorization functions are pure PROVIDER_LOGIC (reused, in spirit, as `normalizeInterPixAttemptStatus`/`normalizeInterBoletoAttemptStatus`); `reconcilePaymentReference` itself is WOO_ANCHORING (writes to a Woo order) | Categorization logic re-derived for the ledger's richer status vocabulary; the Woo-writing function itself not called |
| `app/api/webhooks/inter/route.ts` | WOO_ANCHORING (calls `reconcilePaymentReference`) | Not modified; its "never trust the webhook body, always re-query the provider" principle is the one thing explicitly carried over into `applyNativeInterWebhookNotification` |

One correction to an initial assumption: the legacy Pix `txid` was **already**
derived from a caller-supplied idempotency key, not from the Woo order id —
that part of the legacy path was never Woo-anchored. Only Boleto's
`seuNumero: String(order.id)` is genuinely Woo-anchored.

## 3. Deterministic, Woo-free provider references

- **Pix `txid`**: `deriveNativeInterPixTxid(paymentAttempt.idempotencyKey)` —
  strips non-alphanumerics from the ledger's own `payment_attempts.idempotency_key`
  (unique per `(provider, idempotency_key)`) and validates the Bacen
  26–35-alphanumeric-character format. Same transformation the legacy path
  already applied to its own (checkout-level) idempotency key — only the
  *source* of that key changed, from a Woo-checkout concept to the native
  ledger's own column.
- **Boleto `seuNumero`**: `deriveNativeInterBoletoSeuNumero(idempotencyKey)` —
  SHA-256 of the same idempotency key, truncated to 15 hex characters. Never
  derived from `order.id` (Woo or native).

## 4. Provider-payload boundary (Section 9)

`payment_attempts.provider_reference` (txid / `codigoSolicitacao`) is the
**only** provider-specific value persisted. QR code image/copy-paste and
boleto digitable line/barcode/PDF are **never** persisted — they are always
re-fetched live from Inter using the stored reference
(`getNativeInterPixPresentation`, `getNativeInterBoletoPresentation`,
`getNativeInterBoletoPdf`). This exactly mirrors the legacy status route
(`app/api/checkout/payment/status/route.ts`), which already re-fetches on
every poll instead of caching presentation data anywhere. Consequence: **no
new migration was needed** to add a metadata-storage capability the ledger
schema's functions do not expose.

## 5. Two real defects found and fixed while building this

### 5.1 Boleto creation race (found before any code shipped — via reasoning about `create_native_payment_attempt`'s idempotency together with Boleto's non-idempotent `POST`)

Two truly concurrent calls with the *same* idempotency key both receive the
identical `created` row back from `create_native_payment_attempt` (that
function's own idempotent insert-or-fetch). Naively calling the Inter
provider immediately after that check — as an early draft of this module
did — would let **both** callers issue a `POST /cobranca/v3/cobrancas`
before either had transitioned the attempt, because Inter's Boleto creation
is not idempotent by any client-supplied key (unlike Pix, whose creation is
a `PUT` to a caller-chosen `/pix/v2/cob/{txid}` path).

**Fix**: both `createNativeInterPixPayment` and `createNativeInterBoletoPayment`
now perform an atomic **claim** — `transition_native_payment_attempt(created
-> pending, no reference yet, expectedVersion)` — *before* calling the
provider. Only one of two concurrent callers can win this transition; the
loser catches the resulting `stale_payment_attempt_transition` error and
returns quietly (`charge: null`) instead of racing into the provider call.
Proven at real Postgres under genuine concurrency in
`scripts/database/native-inter-payment-concurrency.mjs` (`boletoOnlyOneClaimWinsProviderCallGate`).

### 5.2 Ambiguous-timeout retry (Section 17) — a deliberate, documented non-fix

A **sequential** retry after this module's own provider call throws (e.g. a
timeout) lands on the exact same DB state (`pending`, no `provider_reference`)
as a caller that merely *lost* the claim race above — the two are
indistinguishable from the row alone. For Pix this is harmless (the retried
`PUT` is idempotent at the provider). For Boleto it is not: blindly retrying
could create a second, logically duplicate charge at Inter with no way to
detect it (there is no "list boletos by `seuNumero`" capability in the
existing client to check first).

**Decision, matching Section 17's own instruction not to improvise**:
`createNativeInterBoletoPayment` refuses to proceed when it observes an
attempt already in `pending` with no `provider_reference` — it throws
`NativeInterBoletoAmbiguousRetryError` instead of guessing. Resolving that
state requires an out-of-band step (support/reconciliation) that does not
exist yet. This is a real, honestly-documented limitation, not a gap that
was silently designed around.

## 6. Webhook & reconciliation (Sections 10–12, 18)

`applyNativeInterWebhookNotification` and `reconcileNativeInterPendingAttempt`
share one rule: **the webhook body's claimed status is never read**. Both
functions only accept a `providerReference` (used to identify which charge)
and an `externalEventId` (webhook dedupe only) — the actual `resultingStatus`
recorded always comes from `verifyNativeInterPaymentStatus`, which re-queries
Inter directly (`getPixChargeStatus` / `getBoletoChargeStatus`). There is no
parameter through which a caller could inject a trusted status. Concretely
proves the required "webhook says paid but a fresh query says pending stays
pending" property (Section 18) — the code has no path for the opposite to
happen.

Duplicate/concurrent webhook delivery correctness is inherited unchanged
from the ledger's own `record_native_payment_event` (dedupe on `(provider,
external_event_id)`, attempt-row locked before the dedupe check — the exact
mechanism and prior bugfix documented in
[74](74-native-payment-ledger-foundation.md#5-real-concurrency-bug-found-and-fixed)).
Out-of-order events (a stale "pending" arriving after a "paid" was already
recorded) are rejected by the same state-machine validity check, recorded
as `stale_ignored` — proven again here, Inter-shaped, in
`outOfOrderEventNeverRegresses`.

## 7. Order boundary (Section 13) and inventory boundary (Section 14) — qualified, NOT wired

**Order boundary — qualified, straightforward, not implemented this round.**
`orders.status` is `pending | confirmed | cancelled | completed`
(`enforce_native_order_status_transition`: `pending -> {confirmed,
cancelled}`, `confirmed -> {completed, cancelled}`). The intended mapping —
`payment_attempt` reaches `paid` → `transition_native_order(pending ->
confirmed)`; reaches a terminal failure (`failed`/`expired`/`cancelled`
with no other attempt outstanding) → `transition_native_order(pending ->
cancelled)` — fits the existing enum with no new state. No code calls this
yet; it is orchestration for a future checkout-wiring phase.

**Inventory boundary — genuine blocker found, documented, deliberately NOT
wired (per Section 14's own instruction).** `confirm_inventory_reservation`
and `release_inventory_reservation`
(`supabase/migrations/20260823110400_inventory.sql`) are:

1. `security invoker`, not `security definer`;
2. never granted `EXECUTE` to `persi_app` or `persi_worker` anywhere in the
   migration history (`20260903130000_public_browser_privilege_remediation.sql`
   only *revokes* their public/anon/authenticated privileges — it never
   grants either application role);
3. never granted table-level `UPDATE` on `inventory_levels`/
   `inventory_reservations` to `persi_app`/`persi_worker` either (required
   in addition to (2) precisely *because* they are `security invoker`).

The only existing caller is `submit_native_checkout`
(`20260905180000_native_checkout_atomic_submission.sql`), itself `security
definer`, which can call them because it runs as the function owner. There
is currently **no entry point** through which a payment-confirmation flow —
running as `persi_worker`, the role `transition_native_payment_attempt`
and `record_native_payment_event` are actually granted to — could call
either function; doing so today would fail with a permission error before
ever reaching the reservation logic. Wiring this correctly needs a new
`security definer` orchestration function (or an equivalent grant + role
change), which is schema work explicitly out of this round's "prefer zero
migration" instruction and — more importantly — real security-boundary
work that should not be improvised inside a payment adapter. **Documented as
a blocker; not implemented.** `INTER_INVENTORY_BOUNDARY_PASS = NO` in the
final report reflects this honestly (qualified, not ready).

## 8. Legacy regression (Section 20)

`git status` for every legacy payment file
(`services/payments/inter/*`, `services/payments/gateway.ts`,
`services/woocommerce/orders.ts`, `services/payments/reconcile.ts`,
`app/api/webhooks/inter/route.ts`, `app/api/checkout/payment/route.ts`,
`app/api/checkout/payment/status/route.ts`) shows **zero** changes — only
`services/payments/inter/nativeAdapter.ts` is new. The full existing test
suite (`tests/paymentsInter.test.mjs`, `tests/paymentsWooOrders.test.mjs`,
`tests/paymentsReconcile.test.mjs`, `tests/checkoutPaymentConfirmation.test.mjs`,
and the rest) passes unchanged. `LEGACY_INTER_PATH_PRESERVED = YES`.

## 9. Refund capability (Section 15) — qualified only

Neither `services/payments/inter/pix.ts` nor `boleto.ts` implements a
refund/devolution or boleto write-off call today — there is no existing
Inter refund integration to reuse. `INTER_REFUND_CAPABILITY =
NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION`, reported honestly rather than
invented.

## 10. Error normalization (Section 16)

`normalizeInterError` maps `InterPaymentError` codes to the required
internal categories (`retryable` is intentionally never assigned blindly —
see Section 5.2 on why Boleto specifically must not auto-retry from an
ambiguous state even though its *category* might otherwise look retryable):

| Inter error code | Category |
|---|---|
| `INTER_TIMEOUT` | `timeout` |
| `INTER_AUTH_FAILED` | `authentication` |
| `INTER_CONFIG_MISSING`, `INTER_*_UNKNOWN_STATUS`, `INTER_BOLETO_INVALID_RESPONSE`, `INTER_PIX_MISSING_COPY_PASTE_CODE`, `INTER_BOLETO_PDF_UNAVAILABLE`, `INTER_NATIVE_TXID_DERIVATION_INVALID` | `non_retryable` |
| HTTP 404 | `not_found` |
| HTTP 409 | `conflict` |
| Other 4xx | `validation` |
| Anything else (5xx, unknown) | `provider_unavailable` |

No raw provider message is persisted anywhere — only the category and,
where the ledger already has a column for it, `failure_code`/`failure_reason`
sourced from this module's own constants, never `error.message` from Inter.

## 11. Testing

- `tests/paymentsInterNativeAdapter.test.mjs` — 20 unit tests, every
  provider/DB seam mocked: reference derivation, status normalization
  (all Pix/Boleto statuses), error normalization, Pix/Boleto creation
  (fresh, retry-safe, claim-race-lost, immediate-terminal-status,
  provider-timeout), Boleto's ambiguous-retry refusal, webhook verification
  (never trusts the caller's claim), reconciliation ("says paid but query
  says pending" stays pending).
- `scripts/database/native-inter-payment-concurrency.mjs` — 5 properties
  against real local Postgres (no provider called): the claim gate actually
  gates Boleto's non-idempotent path; Pix idempotent-create under
  concurrency; the full create→claim→attach-reference→event sequence ends
  consistent; webhook-claim-ignored-when-verification-disagrees; out-of-order
  events never regress a terminal `paid`.
- Regression: pgTAP 666/666 unchanged (migration untouched); full
  `npm test` 1372/1373 (the one pre-existing failure,
  `tests/instagramFeed.test.mjs`, is unrelated to payments and predates this
  round — not modified or investigated further, out of scope).

## 12. What this round does NOT do

- No call to a real Banco Inter endpoint, sandbox or production.
- No wiring into the checkout flow — nothing calls
  `createNativeInterPixPayment`/`createNativeInterBoletoPayment` from any
  route yet.
- No inventory-reservation wiring (Section 7 — documented blocker).
- No order-status transition wiring (Section 7 — qualified only).
- No refund implementation (no existing capability to wire).
- No feature flag (deliberately not created — Section 21: "preferir NÃO
  criar" when it would only be needed by a later integration layer).
- No change to the payment ledger migration (frozen, per this round's own
  Section 0 instruction) or to any legacy Inter/WooCommerce file.
