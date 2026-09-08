# B.3-C3-P2 — Persi store bootstrap preflight

## Scope and verified staging baseline

This phase is read-only and design-only. The verified target is `persi-staging`, project
ref `vtrujmhhkmvjzfklzxip`, PostgreSQL 17.6, with 23/23 migrations. It currently has
zero stores and zero `store_price_list_assignments`. No remote write, backup, migration,
seed or bootstrap was performed in P2.

The only price list is `woo-brl`: BRL, `storefront`, no customer segment, priority 0,
`active`, with 3,080 valid prices for 3,080 variants. Missing and ambiguous prices are
zero; 186 sale prices are currently valid. The code is only an identifier: authority
will exist only after the explicit P1 assignment is created.

## Canonical store schema

`stores` has the following canonical columns:

| Column | Contract |
| --- | --- |
| `id` | UUID primary key; required; defaults to `gen_random_uuid()` |
| `code` | required text; stable machine key; unique; lowercase pattern `^[a-z][a-z0-9_-]{1,49}$` |
| `name` | required text; trimmed length 1–150 |
| `status` | required `record_status`; defaults to `draft` |
| `default_currency` | required `char(3)`; defaults to `BRL`; uppercase ISO-like check |
| `timezone` | required text; defaults to `America/Sao_Paulo`; trimmed length 1–100 |
| `next_order_sequence` | required BIGINT; defaults to 1; must remain at least 1 |
| `created_at` | required timestamptz; defaults to database `now()` |
| `updated_at` | required timestamptz; defaults to database `now()` and has update trigger |

There is no locale or metadata column. There are no store foreign keys. RLS is enabled.
Browser roles have no grants. Existing B3-A grants allow `persi_app` and `persi_worker`
to modify stores; the controlled bootstrap must nevertheless run only with a privileged
administrative connection and must not expose a public route or frontend control.
Assignment configuration remains inaccessible to both normal runtime roles.

## Permanent Persi identity

- machine code: `persi`;
- display name: `Persi Materiais de Construção`;
- UUID: generated once by PostgreSQL inside the authorized transaction, captured in the
  immutable execution report, and never derived from Woo, Olist, domain or display name;
- status: `active`, because the P1 resolver rejects a non-active store. This does not
  enable native runtime; runtime selection remains a separate application concern;
- default currency: `BRL`;
- timezone: `America/Sao_Paulo`;
- locale: absent from the schema; do not add it for bootstrap;
- initial `next_order_sequence`: 1.

`allocate_native_order_number` atomically increments the store counter and formats
`UPPER(store.code)-YYYY-NNNNNN`. Therefore `persi` yields the stable `PERSI` prefix.
The sequence does not reset annually; the year is display material only.

## Initial price authority

The sole proposed assignment is the new Persi UUID + `BRL` + `storefront_retail` +
version 1 + the existing `woo-brl` UUID. `valid_from` must use database transaction time
and `valid_to` must be NULL. This satisfies the P1 store/list/currency/context/version,
half-open validity, no-overlap and composite-FK contracts. No fallback is allowed.

The future read-back must call `resolve_store_price_authority(store_id, 'BRL',
'storefront_retail', transaction_timestamp())` and receive exactly version 1 and
`woo-brl`.

## Controlled bootstrap implementation

Use a dedicated server-only, idempotent bootstrap script, not a schema migration and not
an automatic seed. The script must require all of the following explicit inputs:

- target `persi-staging`;
- project ref `vtrujmhhkmvjzfklzxip`;
- expected price-list code `woo-brl`;
- currency `BRL`;
- context `storefront_retail`;
- explicit `--apply` plus a separate confirmation token for real commercial rows.

The default/`--dry-run` mode must open a read-only transaction, prove the environment,
revalidate the empty store/assignment scope, list identity and price-list facts, verify
coverage and report exactly two intended mutations. It must never print secrets.

Apply mode must require a fresh backup labelled `pre-persi-store-bootstrap` and use one
transaction:

1. prove target/ref and expected schema history;
2. take a transaction-scoped advisory lock for the immutable bootstrap key;
3. verify no store with code `persi` and no conflicting intended identity exists;
4. lock and verify the exact `woo-brl` row and its BRL/storefront/active contract;
5. revalidate 3,080/3,080 current price coverage and zero ambiguity;
6. insert the store, letting PostgreSQL generate its UUID and timestamps;
7. insert assignment version 1 with transaction time and open-ended validity;
8. resolve/read back the exact authority and compare all fields;
9. compare pre/post counts and commit only when exactly two rows changed.

Any failure rolls the transaction back. The idempotency business key is store code
`persi` plus currency/context. An exact rerun verifies UUID, store attributes and the
single version-1 assignment, then returns `ALREADY_BOOTSTRAPPED` without writes. Any
difference, duplicate or unexpected history returns `BOOTSTRAP_CONFLICT`; it must not
silently update, create version 2 or choose another list.

Expected writes are exactly +1 `stores` and +1 `store_price_list_assignments`. Prices,
products, variants, inventory, customers, carts, checkouts, orders, PIM, media, mappings
and shipping must remain unchanged.

## Runtime, Woo and integration boundaries

`CATALOG_DATA_SOURCE` defaults to `woocommerce`; no native cart/checkout/order cutover is
wired. Store `active` is a resolver prerequisite, not a traffic switch. After bootstrap,
Woo remains the cart, checkout, order and current storefront pricing authority. Woo URLs,
Cart-Token, order creation and frontend pricing source must remain unchanged.

No Woo or Olist external mapping is required for native store bootstrap. PIM remains
global and untouched. Loja do Gesseiro is not created; the same pattern can later be
reused with a different generated UUID, unique machine code and explicit price-list
assignment without schema changes.

## Audit and rollback

The execution report must record timestamp, target/ref, script SHA-256, backup path and
manifest hash, store UUID/code/name/status/currency/timezone, assignment UUID/version,
price-list code and UUID (or safe fingerprint), context, validity, resolver result and all
pre/post counts. It must contain no credentials.

Preferred rollback is restoration from the fresh backup while native runtime remains
disabled. Although a controlled reversal could be considered immediately before any
checkout uses the authority, the P1 history guard rejects assignment DELETE and history
must never be bypassed casually. No automated delete rollback should be implemented.

## C3 contact/address prerequisite

The current Next checkout keeps name, email, phone, document and billing/shipping address
in React Hook Form, maps them through the server route `/api/checkout/customer`, and stores
the operational copy in the Woo Store API cart. At payment time the server reads the Woo
cart and uses those addresses to create the Woo order.

Native `checkout_sessions` deliberately stores no contact or address PII. Its shipping
quote snapshot stores postcode, commercial fields and destination/logistics fingerprints,
but not the complete immutable legal/shipping address. It cannot populate native
`orders.contact_*` and `order_addresses` by itself. Saved `customer_addresses` cover only
authenticated reusable address-book data and are not sufficient for guest checkout or an
immutable point-in-time order snapshot.

Before C3 transaction integration, a small separately reviewed schema/security slice is
required for a temporary encrypted checkout contact/address envelope. It must use a
server-only encryption key outside PostgreSQL, prohibit plaintext tax ID, have short
retention, browser-denied DB access, sanitized logs and atomic conversion to immutable
order contact/address snapshots with separate legal retention. P2 does not implement it.

Other C3 work still includes transactional orchestration from the locked cart and selected
shipping quote into the order, inventory confirmation, idempotency/outbox boundaries and
explicit runtime activation gates. Consequently store bootstrap is ready, but the C3
transaction is not ready.

## Gates

- `STORE_BOOTSTRAP_READY = YES`
- `C3_TRANSACTION_READY = NO`
- `C3_PREREQUISITE_SCHEMA_CHANGE_REQUIRED = YES`
- `SAFE_TO_PREPARE_PERSI_BOOTSTRAP = YES`
