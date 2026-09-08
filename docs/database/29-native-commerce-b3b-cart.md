# B.3-B — native cart foundation

## Boundary

`carts` and `cart_items` are a dark, local-first foundation. Woo Store API and
its Cart-Token remain the operational authority; no route, hook, checkout or UI
uses the native model in B.3-B.

## Ownership and token

Every cart belongs to one store. A mutable cart has exactly one owner: global
customer reference or guest capability. The guest token is 32 random bytes,
transported as base64url; PostgreSQL stores only its SHA-256 fingerprint. Lookup
requires store plus fingerprint. UUID knowledge alone is insufficient.

Token comparison helper is server-only and constant-time. Attach/merge must
invalidate the guest fingerprint. A new guest capability means token rotation;
the old raw token can never be recovered from the database and is never logged.

## Lifecycle and retention

Statuses are `active`, `locked`, `converted`, `abandoned`, `expired`, `merged`.
Only active carts mutate. `expires_at` identifies cleanup candidates; B.3-B does
not implement a worker. Abandoned/expired/merged carts have short operational
retention and are not order history. Customer anonymization can later set the
nullable customer reference according to an explicit retention workflow; it
does not cascade through orders.

## Items, price and stock

One `(cart, variant)` line stores requested quantity greater than zero. Repeated
add is atomic and additive; quantity SET is naturally idempotent. No arbitrary
upper bound exists because no approved commercial bound was found. Services
should warn when requested quantity exceeds availability, but retain the request
rather than silently lose it. Cart never reserves stock. Product/variant active,
sellability, current pricing and availability are server validations; checkout
will revalidate authoritatively.

## Merge and concurrency

For a same-store/same-currency login merge, rows are locked in UUID order, item
quantities are summed, the customer cart remains active and the guest source is
marked `merged`, linked to the target and stripped of its capability. Repeating
the same merge returns the target without adding again. Cross-store, currency or
customer merges fail. Mutations lock the cart row, so merge versus item update,
set versus remove and expiry versus mutation serialize at the database boundary.

## Security and query shape

RLS is enabled; anon/authenticated/public have no grants or policies. Only
server roles access tables/functions and `persi_readonly` has no cart access.
Future reads must join cart items, variants, products, current price and
availability in one set-based query, never N+1. Customer and guest lookup,
expiration and item traversal have dedicated indexes.

COUPON_NATIVE_STATUS = FOUNDATION_READY / DEFERRED. Cart schema does not block a
future coupon/promotion aggregate, but no native promotion engine or adjustment
is implemented here. Shipping selection and tax snapshots are also deferred.
