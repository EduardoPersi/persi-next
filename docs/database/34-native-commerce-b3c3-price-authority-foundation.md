# B.3-C3-P1 — Store price authority foundation

## Scope

P1 adds only the local, dark schema and server repository needed to bind a store,
currency and `storefront_retail` context to one authoritative price list. It does not
create business rows, activate native runtime or implement the complete C3 transaction.

The canonical migration is `20260903120000_store_price_authority_foundation.sql`.

## Authority schema

`store_price_list_assignments` stores an immutable identity, `store_id`,
`price_list_id`, currency, `commercial_context`, positive `bigint` version and half-open
validity `[valid_from, valid_to)`. Validity alone represents whether an assignment is
eligible; there is no overlapping status/enabled/deleted flag.

Versions are unique and strictly increasing inside `(store, currency, context)`. Inserts
and overlap checks serialize on a scope-specific PostgreSQL advisory transaction lock.
The caller supplies the next version; the database rejects reuse or regression. No
`MAX(version)+1` allocator exists.

Overlapping validity in the same scope raises `STORE_PRICE_CONFIG_OVERLAP`. Adjacent
periods are valid. Historical identity, version and start time cannot be edited; an open
period may only be closed once. DELETE is forbidden.

The assignment references store normally and uses a composite `(price_list_id,
currency)` FK, backed by a minimal unique constraint on `price_lists`, so mismatched
list currency cannot be persisted. Currency remains part of the authority scope, which
allows independent future currencies for one store. For `storefront_retail`, resolution
also requires `price_lists.channel = storefront`; channel is validation, never authority.

## Resolution and failures

`resolve_store_price_authority(store_id, currency, commercial_context, as_of)` is a
`SECURITY DEFINER`, empty-search-path, server-only primitive. It takes the same advisory
scope lock as configuration writes and requires exactly one assignment. It validates
active store, active list, currency and channel, and returns assignment ID/version,
list, currency, context and validity.

It fails closed with stable internal messages including `STORE_PRICE_CONFIG_MISSING`,
`STORE_PRICE_CONFIG_AMBIGUOUS`, `PRICE_LIST_INACTIVE`, `PRICE_CURRENCY_MISMATCH` and
`PRICE_LIST_CHANNEL_MISMATCH`. It never selects by name, priority or cardinality and
never falls back to WooCommerce or another list.

## Checkout snapshot

`checkout_sessions` gains nullable `store_price_list_assignment_id`,
`store_price_list_assignment_version` and `price_list_id`. They must be all null or all
present, and a composite FK proves store, list, version and currency consistency. Open
and validating sessions may remain unbound. Before `ready`, the complete current
authority is mandatory; the existing privileged C1 preparation path binds it only when
all item price rows belong to that authoritative list. A caller-selected incompatible
list is rejected. From `ready` onward the authority fields are immutable.

The full C3 implementation will remove `price_list_id` from caller-facing intent. P1
keeps the internal C1 database signature for regression compatibility; no browser route
or runtime uses it. Browser roles have neither table access nor resolver execution.

The future price fingerprint contract in `nativePriceAuthority.ts` includes store,
context, assignment ID/version, list, currency, one `as_of`, price ID/validity and
regular/effective `bigint` amounts. It excludes guest capability and secrets.

## Security

RLS is enabled with zero policies. `public`, `anon`, `authenticated` and
`persi_readonly` have no access. `persi_app` and `persi_worker` can execute only the
resolver; neither has direct SELECT or configuration DML. No ordinary role receives
INSERT, UPDATE or DELETE. A future separately authorized administrative function must
close the old period and insert a higher version atomically.

## Multistore, concurrency and performance

Stores resolve independently even when catalog and inventory are shared. Synthetic
tests prove STORE_A cannot resolve STORE_B's list and BRL/USD scopes are independent.

Resolution and configuration use the same advisory scope lock. A checkout/configuration
race therefore sees one complete version or the other, never a mixed assignment/version
snapshot. The authority lookup index begins with `(store_id, currency,
commercial_context)` followed by validity, and price lookup continues to use the
existing `(price_list_id, product_variant_id, valid_from)` index. C3 will resolve one
assignment and all cart prices set-wise, with no N+1.

## Boundaries

P1 does not alter `prices`, products, variants, inventory, orders, shipping or PIM. Olist
may synchronize list contents but cannot change store authority. The full set-based
price/sale/reservation/order transaction remains C3 work.

Schema deployment and business initialization remain separate. A later authorized
bootstrap may create the Persi store and assign the existing `woo-brl` list. This
migration contains no seed and creates neither Persi nor Loja do Gesseiro.
