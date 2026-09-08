# M29-R1 — functional remediation and contract audit

Date: 2026-09-06. Local and strictly offline.

## Baseline and root cause

Canonical S0 was PostgreSQL 17.6 at `127.0.0.1:15422`, with 29 migration files, history 28, last applied `20260905130000`, zero persistent M29 functions and stores/carts/orders `0/0/0`.

R4-C proved that M29 `create_native_cart` referenced `stores.currency`. The authoritative B3-A schema has `default_currency char(3) not null`; it has no `currency` column. The intended condition is unambiguous: a requested cart currency must equal the active store's configured default currency.

## Corrections in the unapplied M29 candidate

Three objective corrections were made without changing migrations 1–28 or creating M30:

1. `s.currency=p_currency` became `s.default_currency=p_currency`.
2. Submission cart freshness now requires `c.version=s.cart_version+1`. M27 records the pre-lock version in the checkout and increments the cart while locking it; M27 readiness already requires this exact relationship.
3. Submission price authority uses enum value `storefront_retail`, the only `commercial_context` value and the same context used by preparation/readiness, instead of invalid literal `checkout`.

No business capability or schema was added.

## Store and full schema audit

M29 store references were checked against the accumulated schema through M28: `id`, `code`, `status`, `default_currency` and `next_order_sequence` exist and have compatible meanings. M29 does not rely on store `name`, `timezone`, `created_at` or `updated_at`. The sole incompatible store reference was corrected.

All M29 relations were traced to prior migrations: `stores`, `customers`, `products`, `product_variants`, `carts`, `cart_items`, `checkout_sessions`, `checkout_session_items`, `checkout_shipping_quotes`, `checkout_shipping_evidence`, `store_price_list_assignments`, `price_lists`, `prices`, `inventory_reservations`, `inventory_levels`, `orders`, `order_items`, `order_addresses` and `order_status_events`. Referenced columns, row types, keys and bigint monetary/quantity fields are present. `order_adjustments` and `inventory_movements` were explicitly reviewed as boundary tables but are not written by M29.

Called-function signatures match migrations 1–28: `canonical_native_checkout_items_fingerprint(uuid)` (M29 helper), `resolve_store_price_authority(uuid,char(3),commercial_context,timestamptz)`, `resolve_checkout_authoritative_price(uuid,uuid,char(3),timestamptz)`, `r1d_shipping_quote_is_authoritative(uuid,uuid,char(3),text,timestamptz)`, `allocate_native_order_number(uuid)`, `link_inventory_reservation_to_order_item(uuid,uuid)`, `validate_native_order_totals(uuid)` and `clear_checkout_pii(uuid,uuid,text,bigint)`.

Enum literals were checked for cart states `active/locked/merged/converted`, checkout states `ready/submitting/order_created`, order state `pending`, address types `billing/shipping`, actor `system`, and commercial context `storefront_retail`. The invalid commercial-context literal was corrected.

## Disposable runtime smoke

A fresh `public.ecr.aws/supabase/postgres:17.6.1.155` container used `--pull never`, loopback dynamic port and tmpfs. Semantic readiness reached three consecutive successes with no regressions. Migrations 1–29 compiled and applied.

Authentic `persi_app_login -> BEGIN -> SET LOCAL ROLE persi_app` smokes passed:

- matching `default_currency` cart creation;
- wrong currency rejected deterministically with `P0002 / ACTIVE_STORE_NOT_FOUND`;
- add item, set quantity, remove item and merge carts;
- submission runtime entry reached and returned expected `P0002 / CHECKOUT_NOT_FOUND` for a synthetic absent checkout;
- app direct cart DML denied with `42501`;
- worker submission denied with `42501`.

Undefined schema error guard results were zero for `42703`, `42883`, `42P01` and `42704`. No permission denial was counted as app functional success.

## Hashes and quality

- historical pre-revision M29: `5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`;
- revised M29 candidate: `0b6f4e228024cd680765c4dec6f56a1df51d3585211e438e06af84d683762ca3`;
- P3-A: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`;
- M26: `8027bdad8973bcb3af92ac956f59dd0f81cae236a21fbe655282adea73c449df`;
- M27: `57eae6e2cead7a3e272c6fb69abddc9d0c58118ef8ad8ef287942d25a9a2cad0`;
- M28: `7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.

Static M29/harness tests passed 10/10. Focused offline identity, SQLSTATE, readiness and isolation regressions passed 32/32. Typecheck and lint passed. The offline production build reached Next.js compilation but failed on the existing `next/font` Google Inter fetch dependency; the offline guard recorded zero actual external requests. This is unrelated to M29.

The disposable container/tmpfs was removed. Canonical S1 remained history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`. No remote system, provider, staging or production was accessed. No commit or push occurred.

M29-R1 is complete. Full R4-C was not restarted. The revised hash is a candidate, not a canonical/applied migration hash.
