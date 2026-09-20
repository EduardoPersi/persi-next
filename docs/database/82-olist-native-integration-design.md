# 82 — Olist Native Integration Design (Track F)

Status: **design only, not implemented**. No migration, no schema change, no
new file under `lib/`, `services/`, or `app/`. No Olist credential was used,
no Olist endpoint was called, no undocumented Olist API contract is assumed
below — every place this design depends on a specific Olist capability
(idempotency key support, lookup-by-external-reference, webhook delivery,
rate-limit headers) is flagged explicitly as **VERIFY_AGAINST_OLIST_DOCS**
rather than assumed. This document extends and refines
[07-olist-integration.md](07-olist-integration.md) specifically for the
native-commerce order path (`orders`/`order_items`, Sections 74–80), not for
catalog/GTIN sync, which already has a separate, working (WordPress-side)
implementation.

## 1. Scope

In scope: the pipeline from a native order reaching a processable state to
an idempotent, retryable export of that order to Olist, with a durable
internal↔external id link and a reconciliation pass. Out of scope: catalog,
GTIN, price, or physical-stock sync (07's authority matrix already covers
these and this document does not revisit them); any actual HTTP call,
credential, or Olist account.

## 2. Re-verification of current state (Section 2 of the brief)

Grepped `olist` (case-insensitive) across the whole repo, `.ts`/`.tsx` files:
three hits, all enum/type placeholders, no order-export logic anywhere:

- `lib/db/schema/core.ts` — `externalSystem` pgEnum includes `"olist"`
  (alongside `woocommerce`, `banco_inter`, `pagbank`, `melhor_envio`,
  `mercadopago`); `pimSource` pgEnum also lists `"olist"` as a catalog
  provenance tag.
- `lib/server/externalIo.ts` — `ExternalProvider` union type includes
  `"olist"` (the fail-closed external-IO gate that
  `PERSI_OFFLINE_VALIDATION` enforces zero real calls against).
- `lib/db/nativeCheckout.ts` — `NativeCheckoutQuoteInput.provider` union type
  includes `"olist"` (shipping-quote provider tagging, unrelated to order
  export).

Grepped `outbox` across the repo: 23 hits, all documentation prose
(`docs/database/*.md`) or comments in existing tests/migrations describing
the *payment* ledger's own already-implemented atomicity, never a table
named `outbox`/`integration_outbox`/`integration_jobs`. Confirmed by reading
`lib/db/schema/integrations.ts` directly: it defines `external_mappings`,
`integration_inbox`, and `integration_checkpoints` — all three are
**inbound**-shaped (`source: externalSystem`, `external_event_id`,
`cursor_value`), built for the "external system → Persi" direction (used
today by `20260824120000_incremental_sync.sql`'s catalog sync work, not by
any order-export path). No **outbound** ("Persi → external") durable queue
exists in the schema. This matches and confirms 07's own finding
("`integration_jobs`... não implementado") — nothing has changed since that
finding.

Also confirmed: `shipments`/`shipment_events`
(`lib/db/schema/shipping.ts`) already implement the *shape* this design
needs for the id-mapping side — `shipments.orderMappingId` +
`orderMappingEntityType` is a composite FK straight into
`external_mappings(id, entity_type)`, enforced in the database
(`shipments_order_mapping_fk`, `20260901120000_shipping_core.sql`), used
today for Melhor Envio. Section 6 below reuses this exact pattern for
Olist's order mapping rather than inventing a new one.

## 3. Order-side authority recap (grounded in 74–80, not re-derived)

`orders.status` (`lib/db/schema/orders.ts`) is a 4-value enum:
`pending → {confirmed, cancelled}`, `confirmed → {completed, cancelled}`
(`CURRENT_ORDER_STATE_MACHINE`, unchanged since B.3-C, re-confirmed in
78 Section 2). Per 78 Section 3/5, the **only** genuine driver of
`pending → confirmed` is `apply_verified_payment_transition` calling
`transition_native_order` unconditionally when a payment attempt reaches
the ledger's `paid` status — atomically, in the same function call that
also confirms the inventory reservation. There is no other code path that
moves an order to `confirmed` today. `order_status_events` records every
transition with a `correlation_id` unique per `(order_id, correlation_id)`.

This is the trigger point this design hooks into (Section 4). It is
deliberately **not** "order created" (`pending`, no payment yet — nothing to
fulfill) and deliberately **not** "order completed" (that status exists for
the order's own lifecycle closure, not for export timing — waiting for it
would delay fulfillment visibility by however long `completed` takes to be
set, which is a different, unrelated event).

`order_items` already carries frozen point-in-time snapshots
(`sku_snapshot`, `gtin_snapshot`, `product_name_snapshot`,
`variant_label_snapshot`, quantities, all amount columns,
`source_fingerprint`) — exactly the shape an ERP export payload needs, and
already immune to later catalog edits (a price change next week must not
silently alter an already-exported order). `order_addresses` carries
shipping/billing snapshots the same way. This means the outbox payload
(Section 5) can be built once, at enqueue time, from already-frozen data —
no second read of mutable catalog/pricing state is needed or safe to do at
send time.

## 4. Where the outbox write belongs — same atomic boundary, not a second step

**The `INSERT INTO integration_outbox` must happen inside the same
`SECURITY DEFINER` function call that performs the order's
`pending → confirmed` transition — today, inside
`apply_verified_payment_transition`
(`20260921000000_shared_payment_order_inventory_orchestration.sql`), at the
point it calls `transition_native_order` toward `confirmed`. It must not be
a separate step performed by application code after that call returns, and
must not be a periodic poll of `orders.status`.**

Reasoning, grounded directly in 78's own finding: a "transition, then
separately enqueue" two-step sequence reopens exactly the non-atomicity
class of bug rounds 74–79 spent their effort eliminating from the
payment/order/inventory boundary — a crash or dropped connection between
the two steps produces a `confirmed` order with **no** export enqueued,
silently, with no error anywhere, discoverable only by a reconciliation
pass stumbling on it later (Section 8). Doing the insert inside the same
function, in the same transaction, makes "order is `confirmed`" and "export
is enqueued" a single atomic fact — consistent with 78 Section 5's own
atomicity philosophy (genuine transitions are unconditional, and the
"forbidden end states" are prevented by one atomic call, not by extra
bookkeeping).

This requires no new `GRANT`: exactly like `confirm_inventory_reservation`
before it (78 Section 2), an `INSERT` into a new table performed *inside* an
existing `SECURITY DEFINER` function (owned by `postgres`) needs no separate
privilege — the "no new grant on the primitive" idiom this project already
established applies identically here.

Cancellation after `confirmed` (`confirmed → cancelled`, e.g. an
out-of-band admin cancellation racing fulfillment) is a real gap this
design does not close: v1 only enqueues on `pending → confirmed`. An order
cancelled after its export was already sent/acknowledged would need a
second outbox event type (`order.cancel`) to tell Olist to void/hold it.
Documented as **POST_V1_OPERATIONAL_GAP**, not resolved here — inventing the
cancellation contract without knowing whether Olist's order API even
supports post-creation cancellation would be exactly the "undocumented API
contract" this document is instructed not to assume.

## 5. Outbox row contents

One row per `(destination, entity_type, internal_id, event_type)` — see
Section 6 for the uniqueness constraint this rests on.

| Field | Purpose |
| --- | --- |
| `destination` | `external_system` enum value, `'olist'` |
| `entity_type` | `'order'` (fixed for v1; leaves room for a future `'order_item'` or `'shipment'` event type without a schema change) |
| `internal_id` | `orders.id` |
| `event_type` | `'order.export'` for v1 (only value that exists); `'order.cancel'` reserved, not implemented (Section 4) |
| `idempotency_key` | see Section 7 |
| `payload_snapshot` | `jsonb`, built once at enqueue time from `orders` + `order_items` + `order_addresses` (Section 3) — never re-read from mutable state at send time |
| `correlation_id` | copied from the order's own `orders.correlation_id` (or the specific `order_status_events` row's correlation id for this transition), so a support engineer can join outbox → order_status_events → payment ledger with one key |
| `status` | `pending \| processing \| sent \| failed \| dead_letter` |
| `attempts` | integer, incremented on each dispatch attempt |
| `last_error_code` | sanitized code only (Section 9) — never a raw provider payload or token |
| `next_attempt_at` | drives the worker's claim query, same idiom as `integration_inbox.next_attempt_at` |
| `locked_at` / `locked_by` | worker lease, `SKIP LOCKED` claim, same idiom as `integration_inbox` |
| `external_reference` | Olist's own order id/reference, once known — mirrored into `external_mappings` (Section 6), kept here too for a cheap single-row lookup without a join |
| `sent_at` | when the export was durably acknowledged |
| `created_at` / `updated_at` | standard |

## 6. External mapping (reuses `external_mappings`, no new table)

No new mapping table — `external_mappings` (`lib/db/schema/integrations.ts`)
already has exactly the right shape and is already the FK target for
`shipments.order_mapping_id` (Section 2). Olist order export writes:

```
system:        'olist'
entity_type:   'order'
internal_id:   orders.id
external_id:   <Olist's returned order id/reference>
status:        'active'
source_version: order.version at export time (bigint, from orders.version)
last_synced_at: now()
```

The existing unique indexes (`external_mappings_external_unique` on
`(system, entity_type, external_id)` and `external_mappings_internal_unique`
on `(system, entity_type, internal_id)`) already give the correct
one-to-one guarantee for free: one Persi order maps to exactly one Olist
order and vice versa, enforced at the database level, with zero new schema.
A future `shipments` row created from an Olist-side fulfillment/tracking
event would reuse `orders_order_mapping_fk`'s exact pattern by pointing
`shipments.order_mapping_id` at this same `external_mappings` row
(`entity_type = 'order'`) — this is precisely why 07 called out
`external_mappings` as reusable, and it holds unchanged for the native
order path.

## 7. Idempotency strategy — two independent layers

**Layer 1 (database-enforced, always active regardless of Olist's API):**
`integration_outbox` carries a unique index on
`(destination, entity_type, internal_id, event_type)`. Because Section 4
puts the enqueue inside the order's own atomic confirmation, this
constraint alone guarantees at most one `order.export` row is ever created
per order — a retried webhook, a replayed reconciliation pass, or a second
concurrent payment-confirmation race loser (78 Section 6's own idempotency
guarantee: only the winner reaches a genuine transition) can never produce
a second outbox row for the same order.

**Layer 2 (adapter-level, defends the actual Olist HTTP call):** before
calling Olist's order-creation endpoint, the adapter first checks
`external_mappings` for an existing `(system='olist', entity_type='order',
internal_id=order.id)` row. If one already exists, the call is skipped —
the order was already exported (possibly by a previous attempt that
crashed after the provider call succeeded but before the local write
committed). This is the same "query state before acting" defense the
project already uses for provider-side ambiguity in
[77 (PagBank), Section 4](77-native-pagbank-gateway-reanchoring.md#4-provider-idempotency--a-real-load-bearing-finding-section-10):
PagBank has no provider-side idempotency key, so an ambiguous outcome is
never blindly retried. The same caution applies here: **VERIFY_AGAINST_OLIST_DOCS**
whether Olist's order-creation endpoint accepts a client-supplied
idempotency key or a lookup-by-external-reference call. If it does, pass
the outbox row's `idempotency_key` (or `order_number`, since that is
already unique per store — `orders_store_number_unique`) as that key. If it
does not, any attempt whose outcome is ambiguous (timeout, connection
reset after the request was sent, 5xx with no clear rejection) must be
routed to `status = 'failed'` with a `last_error_code` marking it
**ambiguous**, not silently retried — a human or a lookup-by-reference call
(if Olist offers one) must resolve it before a second create-order call is
allowed, exactly mirroring 77's own ambiguous-retry-blocked posture rather
than inventing a weaker one for a "less critical" ERP call.

`idempotency_key` itself is computed deterministically and does not depend
on `orders.version`: `sha256('olist:order.export:' || order.id)`. It is
stable for the life of the order-export event type — there is exactly one
meaningful export per order in v1, so the key does not need to change if
the order is retried; it only needs to be unique per order, which Layer 1's
DB constraint already enforces independently.

## 8. Retry / backoff shape

Proposed, not binding — `no rate-limit or timeout numbers from Olist's own
docs were consulted; these are starting defaults a future implementer tunes
against Olist's real limits (**VERIFY_AGAINST_OLIST_DOCS**):

- Small batches (matches 07's own recommendation), claimed with
  `SELECT ... FOR UPDATE SKIP LOCKED` ordered by `next_attempt_at`, same
  idiom as `integration_inbox`'s `integration_inbox_work_idx`.
- Exponential backoff with jitter: base 30s, doubling, capped at 30 minutes
  between attempts.
- Max attempts before `dead_letter`: 10. A `dead_letter` row requires
  operator action (Section 9) — the worker never auto-retries it further.
- A `429` response (if Olist returns one) should respect a `Retry-After`
  header if Olist's API provides one; if not, fall back to the same
  exponential schedule above. Either way, a `429`/`5xx` sequence is exactly
  the alert class 07 already lists ("sequência de 401/429/5xx").
- A `401`/`403` is never retried on the same schedule as a transient
  failure — it indicates an expired/invalid credential and should
  immediately raise an operator alert (credential rotation is an
  operational action, not something a backoff loop can fix).

## 9. What schema is MISSING — precise enough to migrate without guessing

Two new tables, both **outbound**-shaped (mirroring `integration_inbox`'s
already-proven inbound shape, per Section 2's finding that no outbound
queue exists today). Column list is a specification for a future migration
author, not a runnable migration:

```
integration_outbox
  id                 uuid primary key default gen_random_uuid()
  destination        external_system not null            -- reuse existing enum
  entity_type        text not null                        -- 'order' for v1
  internal_id        uuid not null                         -- orders.id
  event_type         text not null                         -- 'order.export' for v1
  idempotency_key    text not null
  payload_snapshot   jsonb not null
  correlation_id     uuid not null
  status             text not null default 'pending'       -- pending|processing|sent|failed|dead_letter
  attempts           integer not null default 0
  last_error_code    text
  external_reference text
  next_attempt_at    timestamptz not null default now()
  locked_at          timestamptz
  locked_by          text
  sent_at            timestamptz
  created_at         timestamptz not null default now()
  updated_at         timestamptz not null default now()

  unique (destination, entity_type, internal_id, event_type)
  unique (idempotency_key)
  index on (next_attempt_at, status) where status in ('pending', 'failed')
  index on (destination, entity_type, internal_id)

integration_errors
  id             uuid primary key default gen_random_uuid()
  outbox_id      uuid not null references integration_outbox(id) on delete cascade
  occurred_at    timestamptz not null default now()
  stage          text not null       -- e.g. 'adapter_call' | 'mapping_write' | 'validation'
  error_code     text not null       -- sanitized only, never raw payload/token (Section 2 rule: "payload sensível fica fora")
  retryable      boolean not null
  correlation_id uuid not null
  created_at     timestamptz not null default now()

  index on (outbox_id, occurred_at)
```

Grants (mirrors the established pattern exactly): `EXECUTE` on whatever
`SECURITY DEFINER` function performs the enqueue insert stays scoped to
`postgres`-as-owner (Section 4 — no new grant needed there). The drain
worker's own claim/update statements against `integration_outbox` and
insert into `integration_errors` are granted to `persi_worker` **only** —
`PUBLIC`, `anon`, `authenticated`, and `persi_app` get none of it, matching
78 Section 11's boundary (`persi_worker` alone confirms/transitions
privileged state; the browser-facing role never does).

## 10. Reconciliation pass — what it checks

A read-mostly job, run on its own schedule, independent of the drain
worker:

1. **Missing-enqueue check**: any `orders` row with `status IN ('confirmed',
   'completed')` and no matching `integration_outbox` row
   `(destination='olist', entity_type='order', internal_id=orders.id)` —
   this should be structurally impossible per Section 4's atomicity
   argument, so a hit here means the atomic-enqueue invariant itself was
   violated (a real bug, alert immediately, do not auto-remediate blindly).
2. **Sent-without-mapping check**: any `integration_outbox` row with
   `status='sent'` and no corresponding `external_mappings` row — indicates
   the local write of the mapping failed after a successful provider call
   (an ambiguous-outcome case Section 7 says must not be silently retried);
   surfaces exactly the case that needs a lookup-by-reference call or
   manual operator resolution.
3. **Stale lease reclaim**: any row with `status='processing'` and
   `locked_at` older than the worker's lease timeout — reclaimed back to
   `pending` for the next claim, the same idiom as
   [80](80-native-reservation-expiration-recovery.md)'s
   `reclaim_expired_native_reservations` for a worker that crashed
   mid-attempt.
4. **Dead-letter / high-attempt surfacing**: any row in `dead_letter` or
   with `attempts` above a warn threshold — reported for operator action,
   never auto-retried past the configured max (Section 8).
5. **Backlog/lag reporting**: count and age of `pending`/`failed` rows,
   matching 07's own observability recommendation (cursor lag, backlog,
   retries, rate limits).

Reconciliation is explicitly **not** corrective for the "already `sent` and
mapped" case — once a mapping exists, the pass only reports, it never
re-sends (Section 7 Layer 2 already prevents a duplicate call, but
reconciliation itself should not be the thing attempting a duplicate call
in the first place).

## 11. Security

No Olist credential is described, stored, or referenced by this document.
Whatever credential a future implementation uses (OAuth token, API key)
follows the same rule already binding for every other provider in this
project (AGENTS.md §19.3 / §23): private env var, never a `NEXT_PUBLIC_`
prefix, never logged, never placed in `payload_snapshot` or
`last_error_code`. The adapter call itself is server-only, invoked from the
drain worker process — never reachable from a browser-facing route, exactly
like the three payment gateway adapters it sits alongside architecturally.

## 12. Classification — BLOCKING_FOR_PRODUCTION or OPERATIONAL_FOLLOWUP

**OPERATIONAL_FOLLOWUP**, for the specific question this classification is
scoped to: *is native checkout safe and correct for payments and inventory
without Olist wired up?* Yes — reasoned explicitly, not asserted:

- Payment correctness (ledger state machine, idempotency, cross-order
  isolation, atomic rollback on failure) is fully proven in 74–79 under
  real concurrency, and none of that proof, nor the code it proves, touches
  Olist in any way — `apply_verified_payment_transition`'s only external
  dependency is the payment gateway adapter (Inter/Mercado Pago/PagBank),
  never an ERP.
- Inventory correctness (reservation confirm/release, the
  `inventory_levels_reservation_check` constraint, the expiration/reclaim
  worker in 80) is likewise fully self-contained inside Persi's own
  schema. Per 07's own authority matrix (Section 2 above), Olist's role for
  stock is the **physical/ERP on-hand** balance, reconciled asynchronously
  into Persi — Persi's own reservation ledger already governs
  `available`/`reserved` for the storefront independent of that
  reconciliation, so a missing or delayed Olist sync does not create an
  oversell risk for the e-commerce side.
- A missing or broken Olist export therefore cannot produce a wrong charge,
  a double-sold item, or a corrupted order ledger — the failure mode is
  "Olist doesn't yet know about a paid order," which is a fulfillment
  *visibility* gap, not a payment- or inventory-*safety* gap.

**Explicit caveat, not glossed over**: this classification answers the
safety/correctness question, not the "can we actually ship and fulfill
orders" question. If native checkout is cut over to production **before**
either this pipeline or some interim substitute exists, paid orders would
be correctly and safely recorded in Persi's own ledger but invisible to
whatever operational process (today, Olist/Woo) warehouse staff use to pick
and ship — a real operational blocker for *going live*, just not a
payment/inventory *correctness* blocker. Per AGENTS.md §35's own conflict
ordering (payment/order integrity ranks above general operational
convenience, but §3's "não quebrar o que já funciona" and the project's
own commercial continuity still apply), the recommendation is: build this
pipeline (or an equivalent interim fulfillment-visibility path) **before**
native checkout's production cutover, but do not treat it as a gate on the
payment/inventory work itself, which has already been independently
qualified.

## 13. What this document does NOT do

- No migration file, no schema change, no code in `lib/`, `services/`, or
  `app/`.
- No Olist credential, endpoint, or account was touched or referenced.
- No assumption about Olist's actual idempotency-key support,
  lookup-by-reference capability, webhook delivery, or rate-limit headers —
  each is flagged **VERIFY_AGAINST_OLIST_DOCS** at the point it matters
  (Sections 7, 8).
- No resolution of the `order.cancel`/post-confirmation-cancellation gap
  (Section 4) — documented as `POST_V1_OPERATIONAL_GAP`.
- No decision on physical-stock reconciliation cadence/granularity — 07's
  own open point ("confirmar se Olist será autoridade de `on_hand` por
  local") is unchanged and not re-litigated here.
