# B.3-C3-P3 — secure checkout PII and C3 transaction preflight

## Scope and verified baseline

This phase is design and audit only. No migration, PII persistence, grant change,
runtime wiring or remote write was performed. The read-only staging audit verified
`persi-staging` (`vtrujmhhkmvjzfklzxip`), PostgreSQL 17.6, 23/23 migrations through
`20260903120000`, one Persi store and one version-1 `woo-brl` assignment. Customers,
carts, checkouts, orders, reservations and movements remain zero.

## Current browser, Next and Woo checkout flow

`CheckoutForm` uses React Hook Form with the shared Zod `checkoutSchema`. Contact input
contains email, first name, last name, optional company, Brazilian phone, person type
and CPF/CNPJ. The schema trims text, validates email, phone, the selected document type
and the complete active address. Terms and an optional 500-character order note are
also client-side form state.

Billing and optional shipping addresses contain postcode, street, number, complement,
neighborhood, city, state, country BR and recipient. Company comes from contact rather
than each address. When shipping equals billing, billing is the source for both. CEP is
normalized to eight digits, state to uppercase, phone to digits, and the Woo mapper
combines street + number into `address_1` and neighborhood + complement into
`address_2`. Recipient is split into Woo first/last name. This mapping loses the
structural street/number/neighborhood boundary when data is read back from Woo.

The browser sends only the mapped billing and shipping payload to
`POST /api/checkout/customer`. The route requires the HTTP-only cart-token cookie,
enforces a 16 KiB request bound, strictly validates the payload and calls the Woo Store
API `cart/update-customer`. It returns generic validation/service errors. The current
Next database does not persist that contact/address payload; Woo's cart is the current
operational copy. Payment later reads the Woo cart, requires complete addresses and
creates a Woo pending order.

CPF/CNPJ is captured and validated in the browser form but is not part of the customer
address route. It is sent to the Next payment route at submission, normalized to digits
inside the relevant provider adapter and transmitted to Banco Inter, Mercado Pago or
PagBank as required. The current `createPendingOrder` call does not persist the document
in Woo order fields. Next has no durable plaintext document store in this path.

## Logging audit

The customer route and Woo Store cart diagnostics log endpoint/status/duration only;
they do not log the address request. Checkout payment milestone/error logs contain
attempt/order/provider identifiers and status, not the customer payload.

There are unsafe generic response-body logging surfaces elsewhere: Woo REST errors log
the complete parsed provider response, and PagBank/Mercado Pago clients log provider
error objects (`error_messages`/`cause`). Those objects can contain echoed request
fields or other PII. They must be replaced by an allowlisted sanitizer before native
PII runtime or continued use for PII-bearing writes. Never log request bodies,
ciphertext, email, phone, address, postcode, tax ID, raw upstream body or secret. Safe
logs contain only stable error code/category, HTTP status, provider, operation,
correlation ID and duration.

## C1 checkout facts and gap

`checkout_sessions` stores store/cart/customer ownership, status, currency,
idempotency key, request hash, cart version, correlation ID, shipping-required flag,
expiry, optimistic version and the P1 assignment/list/version snapshot. Guest ownership
is checked against the cart's token fingerprint inside the server-only preparation
function; UUID knowledge alone is insufficient.

`checkout_session_items` contains immutable line, product/variant, SKU/name, quantity,
BIGINT price/tax/discount totals, price validity and price/source fingerprints.
`checkout_shipping_quotes` contains selected state, amount/currency, service/provider,
destination postcode and fingerprint, logistics fingerprint/version, quote timestamps
and expiry. Its destination fingerprint is accepted as a server parameter today; the
repository has no canonical full-address fingerprint producer yet.

Checkout snapshots and quotes may change only while open/validating, and selected quote
expiry is indexed. A checkout moves through open, validating, ready, submitting,
order_created, expired or cancelled. No complete contact/address source, encrypted PII,
PII fingerprint/version or PII-specific retention exists.

## C2 durable order snapshot

`orders` requires immutable contact name and lowercase email, with optional E.164 phone.
It already defines the single approved tax-document bundle: type (`cpf`/`cnpj`),
application ciphertext, 64-hex fingerprint and optional masked representation. The
bundle constraint forbids a partial required representation.

Exactly one immutable billing and one immutable shipping `order_addresses` row must be
created from the validated checkout snapshot. Each holds recipient, optional company,
street, number, optional complement, neighborhood, city, uppercase state, eight-digit
postcode and country. A mutable customer address may be recorded only as provenance; it
must never be the later reconstruction source.

`order_status_events` already allows `from_status IS NULL`, requires a non-null target,
has a unique initial-event index and is append-only. Thus `NULL -> pending` is
representable, but no deferred invariant currently prevents an order from committing
without that initial event.

## Minimal temporary PII envelope

Extend `checkout_sessions`; a separate normalized checkout-address table is not
justified. The encrypted JSON payload is versioned and contains only:

- contact: first name, last name, optional company, normalized lowercase email and
  normalized E.164 phone;
- billing and shipping: recipient, optional company, street, number, optional
  complement, neighborhood, city, uppercase state, eight-digit postcode and country;
- tax document: type and normalized value inside ciphertext only;
- whether shipping was explicitly copied from billing.

Do not include payment credentials, card token, provider secrets, cart capability,
prices, stock, order note or unnecessary profile data.

Use Node's built-in `node:crypto` AES-256-GCM with a fresh cryptographically random
96-bit IV for every encryption. Store ciphertext, IV and authentication tag separately
as base64url text, plus integer envelope version, non-secret key ID, 64-hex keyed
fingerprint, expiry and update timestamp. Bind version, key ID, checkout ID, store ID
and purpose as authenticated additional data. The 256-bit encryption key remains in a
server-only secret manager/environment variable, outside PostgreSQL, browser bundles,
logs and source control. PostgreSQL never decrypts.

Use HMAC-SHA-256 with a separate server-only fingerprint key over a length-safe,
canonical normalized representation. Domain-separate full-envelope, shipping
destination and tax-document fingerprints. A raw PII SHA-256 is forbidden because
postcode, phone and CPF/CNPJ are dictionary-attackable. The fingerprint detects retry
changes; it neither encrypts nor authorizes.

At C3, decrypt and authenticate before opening the DB transaction, revalidate the
payload, and prepare a separately encrypted tax-document bundle for the existing order
columns. Use a distinct nonce and purpose for that durable ciphertext. Never copy the
temporary whole-envelope ciphertext into `orders.tax_id_ciphertext`.

## Persistence, lifecycle and ownership

A dedicated server-only operation may set the envelope only after validating the same
customer or guest cart capability as checkout preparation. It must accept no arbitrary
store/list authority. Guest checkout requires no customer row. Authenticated customer
data may prefill the browser but the explicitly submitted checkout snapshot is
authoritative for this order.

Envelope creation/update is allowed only for open/validating and before expiry, using
expected checkout version and current capability. It becomes immutable at ready. If an
address changes after ready, close/cancel the checkout through the controlled flow,
release its active reservations and create/revalidate a new checkout and quote; do not
mutate ready back to validating. Any pre-ready shipping change deletes/invalidates the
old quote and requires a new destination/logistics fingerprint before ready.

Set PII expiry no later than checkout expiry. After successful order creation, clear
the temporary envelope in the same transaction only after durable order snapshots are
inserted; retain only non-PII audit metadata. Expired/cancelled cleanup must erase the
envelope promptly with a short operational grace period (recommended maximum 24 hours,
configured below legal order retention). A later worker may perform expiry cleanup;
legal order retention applies only to encrypted durable order snapshots.

Errors are stable codes such as `CHECKOUT_PII_REQUIRED`, `CHECKOUT_PII_INVALID`,
`CHECKOUT_PII_AUTH_FAILED`, `CHECKOUT_PII_CHANGED`, `SHIPPING_DESTINATION_CHANGED`,
`SHIPPING_QUOTE_EXPIRED`, `CHECKOUT_OWNER_DENIED` and
`CHECKOUT_SUBMITTING_INCONSISTENT`. Responses and logs never echo sensitive values.

## Shipping/address binding

The future server derives `destination_fingerprint` as a domain-separated keyed HMAC of
the exact normalized shipping address that will become the shipping order snapshot.
The selected quote must carry that fingerprint. Immediately before C3, require exactly
one selected quote when shipping is required; verify it is unexpired and matches the
decrypted shipping address, postcode, currency, checkout/cart version, deterministically
sorted variant quantities, inventory location, service code and current logistics
version/fingerprint. A cached/provider quote is evidence, not final authority. Any
mismatch fails `SHIPPING_DESTINATION_CHANGED` or `SHIPPING_QUOTE_STALE`.

## Store DML remediation

Staging confirms `persi_app` and `persi_worker` each have INSERT, SELECT and UPDATE on
`stores`, backed by `FOR ALL USING(true) WITH CHECK(true)` policies. Repository runtime
contains no store INSERT/UPDATE use; only local audit/concurrency/bootstrap scripts do.
`persi_readonly` has SELECT and a SELECT policy; browser roles have none.

The future minimal migration must revoke INSERT/UPDATE from both runtime roles, drop
`stores_app` and `stores_worker`, recreate explicit SELECT-only policies for the reads
actually needed, and grant SELECT only. Preserve the Persi row, readonly policy,
assignments and resolver. Administrative configuration stays on a privileged path; do
not create an admin endpoint. This is a schema/security migration and a native-runtime
blocker, not a bootstrap blocker.

## Reservation-to-order linkage and lifecycle

Reservations have UUID PK, level FK, positive BIGINT quantity, status, generic
reference/idempotency, expiry and lifecycle timestamps, plus nullable
`checkout_session_item_id`. Unique indexes enforce idempotency and one reservation per
checkout item/level. There is no order or order-item link and no expiry worker in this
foundation.

Add nullable `order_item_id` to `inventory_reservations`, with restrictive FK to
`order_items`, a partial unique `(order_item_id, inventory_level_id)` index, and a guard
that allows a one-time null-to-value link only while active. `order_id` is redundant
because order item determines it. The controlled C3 function must verify that checkout
item, order item and inventory level all identify the same variant/quantity before
linking the existing reservation. It must never reserve again or release/re-reserve.

At order creation the reservation remains active. B3-D later confirms it only after
verified payment. Cancellation/expiry releases it. Late payment must never resurrect an
expired/released reservation; B3-D must reject or reconcile it without overselling.

## Initial event and idempotent recovery

Add a deferred constraint trigger requiring exactly one initial `NULL -> pending`
system event for every new order at commit. C3 inserts that event in the same transaction
and uses a deterministic correlation ID derived from the checkout/order operation.

Checkout idempotency is `(store_id,idempotency_key)` plus immutable `request_hash`;
orders already uniquely reference `checkout_session_id`. The future v2 request hash must
include the PII fingerprint and shipping destination fingerprint, and authority must be
resolved server-side rather than supplied by the browser. Same key/hash returns the
same canonical checkout/order; a changed hash is a conflict.

On retry, lock/read checkout first. `order_created` returns the unique linked order
without allocating a number, reserving or inserting snapshots again. With one DB
transaction, a failed attempt rolls back submitting, allocation, order and cart
conversion; a committed attempt exposes order_created plus the order. A durable
submitting row with no order is therefore an invariant violation and fails closed for
manual reconciliation; it must not blindly recreate anything.

Order-number allocation updates the store counter inside the transaction, so rollback
also rolls back the sequence increment. The first eventual number is
`PERSI-YYYY-000001`; this phase did not allocate it.

## Pricing, totals and adjustments

C3 resolves Persi's `BRL/storefront_retail` authority under the P1 advisory lock and
uses version 1 / `woo-brl` today. No browser-selected price-list parameter is accepted.
Set one transaction `as_of`, revalidate price rows and compare immutable item
fingerprints. All amounts and arithmetic use BIGINT minor units.

Order totals remain:

`grand = items subtotal - discounts + shipping + tax + fees`.

Line snapshots provide subtotal/line discount/tax. Shipping uses the selected quote
snapshot. Coupons, promotions, payment/shipping discounts, fees and corrections use the
existing typed adjustment rows. No coupon engine is added and browser totals are never
authoritative.

## Canonical lock and transaction contract

All C3 callers use this order:

1. verify server-authenticated customer/guest capability and idempotency inputs;
2. decrypt/authenticate/revalidate PII outside the DB transaction;
3. begin transaction and establish one `transaction_timestamp()` as-of value;
4. lock checkout session; return its linked order if already order_created;
5. lock cart and validate owner, active/locked state, expiry and version;
6. acquire P1's scope-specific authority advisory lock by calling the resolver; validate
   Persi assignment/list/version and retain the lock until commit;
7. lock checkout items and selected quote in stable ID order; validate snapshots,
   destination/logistics binding and expiry;
8. lock inventory levels in ascending UUID order, then their active reservations in
   ascending UUID order; validate exact existing quantities and expiry;
9. transition checkout ready -> submitting;
10. allocate the atomic store order number;
11. insert pending order, immutable items, billing/shipping addresses and adjustments;
12. link those same active reservations to their exact order items;
13. validate authoritative totals and insert initial `NULL -> pending` event;
14. transition checkout to order_created, clear temporary PII and convert the cart;
15. commit and return the canonical order.

No network/provider/Olist call occurs inside the transaction. Any error rolls back all
steps, including order number and submitting/cart state. A stock=1/two-checkout local
test must prove only one reserved order path and zero overselling before deployment.

## External boundaries

There is no `integration_outbox` table yet. It belongs to the later B3-G integration
slice and does not block the local native-order commit; asynchronous integration must
eventually be added without calling Olist inside C3. Payment attempts/events/refunds do
not exist and belong to B3-D. C3 creates an unpaid pending order and leaves reservations
active. It snapshots shipping commercial data but creates no external shipment/label.
PIM remains unrelated and untouched.

## Future migration impact and split

### P3-A — secure envelope

- modify `checkout_sessions` with ciphertext, IV, tag, envelope version, key ID,
  keyed fingerprint, PII expiry and update timestamp;
- add complete-bundle/format/expiry checks and a PII-expiry index;
- add/adjust a server-only controlled persistence/preparation function and mutability
  trigger; no browser grants or policies;
- implement server-only AES-GCM/HMAC canonicalization, redacted errors and logging tests.

### P3-B — database prerequisites

- harden `stores` grants/policies to SELECT-only for app/worker;
- add `inventory_reservations.order_item_id`, FK, partial unique index and immutable
  one-time linkage/scope guard;
- add the deferred initial-event constraint trigger;
- add the atomic C3 database function only in the later C3 implementation, not merely
  to satisfy this prerequisite migration.

No new table is required for P3 itself. Expected modified tables are
`checkout_sessions`, `inventory_reservations` and security metadata for `stores`;
`orders/order_status_events` receive the deferred invariant trigger without new data
columns. RLS stays enabled; no public/anon/authenticated access is introduced.

### P3-C — integrated local gate

Test encryption tamper/wrong-key/version handling, no plaintext/log leakage, guest and
customer ownership, PII lifecycle, quote/address changes, exact reservation linkage,
initial event, idempotent retry/recovery, rollback, authority reconfiguration races and
stock=1 concurrency. Only after local pgTAP/runtime/typecheck/build/lint gates pass may a
separate authorized staging deployment be proposed.

## Gates

- `CHECKOUT_PII_GAP_CONFIRMED = YES`
- `SECURE_ENVELOPE_DESIGN_COMPLETE = YES`
- `ENCRYPTION_KEY_OUTSIDE_DB = YES`
- `GUEST_CHECKOUT_SAFE_DESIGN = YES`
- `ORDER_ADDRESS_SNAPSHOT_SOURCE_DEFINED = YES`
- `SHIPPING_ADDRESS_BINDING_DEFINED = YES`
- `PII_LOGGING_RISK_CLASSIFIED = YES`
- `STORE_DML_REMEDIATION_DEFINED = YES`
- `RESERVATION_ORDER_LINKAGE_DEFINED = YES`
- `INITIAL_ORDER_EVENT_DEFINED = YES`
- `CHECKOUT_ORDER_IDEMPOTENCY_DEFINED = YES`
- `C3_LOCK_ORDER_DEFINED = YES`
- `C3_TRANSACTION_CONTRACT_DEFINED = YES`
- `P3_SCHEMA_CHANGE_REQUIRED = YES`
- `P3_IMPLEMENTATION_SPLIT_DEFINED = YES`
- `STAGING_READ_ONLY_PASS = YES`
- `STAGING_WRITES_ZERO = YES`
- `NATIVE_RUNTIME_ENABLED = NO`
- `C3_TRANSACTION_READY = NO`
- `SAFE_TO_IMPLEMENT_P3_LOCAL = YES`
