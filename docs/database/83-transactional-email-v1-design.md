# 83 — Transactional Email v1 Design for Native Commerce (Track G)

Status: **design only, not implemented, no code changed, no email sent, no
provider called, no dependency installed**. This round produced exactly one
new file — this document. No migration, no schema file, no service module,
no route, no `package.json` change. Every schema/interface sketch below is
a proposal for a future round to implement and qualify, following the same
"design → local qualification → shadow → canary" discipline as every prior
native-commerce round (docs/database/74–80).

## 1. What exists today (re-verified this round)

### 1.1 Next.js runtime: zero outbound-email capability

`grep -rli` for `nodemailer|resend\.com|sendgrid|mailgun|smtp|postmark|
@aws-sdk/client-ses` across `app/`, `lib/`, `services/`, and `package.json`
returns nothing. No email-sending dependency is installed, and no module in
the Next.js app opens an SMTP connection or calls an email-provider HTTP
API. This confirms the prior finding; it has not changed.

### 1.2 Password reset is a pure proxy to WordPress — not a Next.js email capability

`app/api/account/forgot-password/route.ts` and `app/api/account/reset-
password/route.ts` do not send email themselves. Both are thin validation/
reCAPTCHA wrappers around `services/account/access.ts`
(`forgotAccountPassword` / `resetAccountPassword`), which call
`requestAccountEndpoint` in `services/account/client.ts`. That function does
one thing: an authenticated `fetch` to
`${WORDPRESS_URL}/wp-json/persi-account/v1/forgot-password` (or
`/reset-password`). The actual email — subject, body, reset-link generation
— is entirely WordPress's responsibility on the other side of that HTTP
call; nothing about it is visible to, or controllable from, the Next.js
codebase.

**Conclusion for this design**: there is no existing outbound-email
mechanism in the Next.js runtime to reuse. A v1 transactional-email
pipeline for native-commerce orders starts from nothing — no library, no
adapter, no template renderer, no outbox table. This also means the
forgot-password flow is not a usable analog for "how do we already send
email from Next.js"; it is an analog only for "how do we already delegate a
side effect across the WP boundary," which is the opposite of what native
commerce needs (native commerce's whole point is to stop depending on
WooCommerce/WordPress for order processing).

### 1.3 WordPress-side email is real but unrelated

`wordpress-plugin/persi-headless/includes/newsletter/class-newsletter.php`
and `.../stock-notifications/class-stock-notifications.php` call PHP's
native `wp_mail()` for newsletter confirmation and back-in-stock alerts.
These are real, live, WordPress-side mechanisms, entirely outside the
Next.js app, and orthogonal to order/payment emails. They are not reused or
modified by anything in this design; they are noted only so a future reader
does not conflate "Persi already sends transactional email" (true, on the
WordPress side, for two specific use cases) with "native commerce already
has an email pipeline" (false).

### 1.4 What native commerce currently has that email would key off

- `payment_attempts.status` (`payment_attempt_status` enum, `lib/db/schema/
  payments.ts`): `created, pending, authorized, paid, failed, cancelled,
  expired, refunded, partially_refunded`.
- `orders.status` (`order_status` enum, `lib/db/schema/orders.ts`):
  `pending, confirmed, cancelled, completed`. Narrower than payment status
  by design (docs/database/78 §2: `CURRENT_ORDER_STATE_MACHINE` is
  `pending → {confirmed, cancelled}`, `confirmed → {completed,
  cancelled}`).
- `order_status_events` and `payment_events`: append-only, already-existing
  audit trails of every transition, each carrying a `correlation_id`.
  `apply_verified_payment_transition` (docs/database/78 §3) is the one
  `SECURITY DEFINER` SQL entrypoint that, in a single transaction, updates
  `payment_attempts`, inserts a `payment_events` row, conditionally
  transitions `orders.status`, and conditionally confirms/releases
  inventory reservations.
- `orders.contactEmail` (`text().notNull()`): plaintext, not encrypted
  (unlike `taxIdCiphertext`). The recipient address for every order-related
  email is already sitting on the row with no PII-decryption step needed.
- `shipments` / `shipment_events` (`lib/db/schema/shipping.ts`) with
  `shipment_status` enum (`pending, preparing, ready_to_ship, posted,
  in_transit, out_for_delivery, delivered, delivery_failed, delayed,
  returning, returned, cancelled`). **Caveat**: `shipments.orderMappingId`
  + `orderMappingEntityType` is a composite FK into `external_mappings`
  (`entity_type = 'order'`), which today is the WooCommerce/Olist-oriented
  order-mapping table. Whether a *native* order gets its own
  `external_mappings` row (so shipment tracking can key off it) or needs a
  separate linkage is **not resolved by this document** — it is a
  prerequisite gap for the shipment/tracking email specifically, called out
  in §4.6, not something this round invents an answer for.
- `submit_native_checkout` (`lib/db/nativeCheckout.ts` /
  `services/checkout/nativeCheckoutService.ts`, docs/database/79): the one
  entrypoint that creates a native order from a ready checkout session,
  idempotent on `(checkoutId, idempotencyKey)`.
- `reservationExpirationWorker.ts` / `services/payments/
  cronReconciliation.ts`: the existing pattern for "a bounded-batch,
  time-budgeted loop, not yet wired to any scheduler route, designed so a
  future authorized cron wiring doesn't have to invent the shape." §5 below
  reuses this exact shape for email dispatch.
- `docs/database/82-olist-native-integration-design.md` does not exist yet
  at the time of this round (Track F has not landed). This design does not
  depend on it; where an outbox-pattern parallel is useful it is described
  inline rather than by reference.

## 2. v1 email event catalog

Every event below is tied to an **actual, already-existing** enum value —
none are invented. Events not backed by a real status transition today
(shipment/tracking, in particular) are marked as blocked and why.

| # | Event | Trigger (domain transition) | Recipient | v1? |
|---|---|---|---|---|
| 1 | Order received | `orders.status` created at `pending` (i.e. `submit_native_checkout` succeeds and inserts the order row) | `orders.contactEmail` | Yes |
| 2 | Pix payment pending | `payment_attempts.status` → `pending` where `method = 'pix'` | `orders.contactEmail` | Yes |
| 3 | Boleto payment pending | `payment_attempts.status` → `pending` where `method = 'boleto'` | `orders.contactEmail` | Yes |
| 4 | Payment approved | `payment_attempts.status` → `paid` (via `apply_verified_payment_transition`), which is also the transition that flips `orders.status` `pending → confirmed` | `orders.contactEmail` | Yes |
| 5 | Payment failed | `payment_attempts.status` → `failed` | `orders.contactEmail` | Yes, but see §2.1 |
| 6 | Order cancelled | `orders.status` → `cancelled` (`order_status_events.to_status = 'cancelled'`) | `orders.contactEmail` | Yes |
| 7 | Shipment posted / out for delivery / delivered | `shipment_events.status` transitions on `shipments` | `orders.contactEmail` | **Blocked** — see §4.6, not v1 |

### 2.1 Payment-failed emails need a debounce, not a 1:1 trigger

`payment_attempts` can legitimately cycle through `failed` multiple times
for the same order (customer retries with a different card, a webhook
retriggers a reconciliation probe with `duplicate_ignored`/`stale_ignored`
results that never reach `failed` again, etc.). A naive "send one email per
`failed` transition" is not wrong, but the event catalog explicitly scopes
v1 to: one email per **payment attempt id** that terminally reaches
`failed` (not per event on that attempt — `payment_events` may record
several `webhook_received` rows before/after the attempt's status column
actually flips). This is enforced by the outbox idempotency key in §3.2
(`event_source = 'payment_attempt', event_id = attempt.id, event_kind =
'failed'`), not by suppressing legitimate business signal.

### 2.2 v1 explicitly excludes

- Refund emails (`refunds` table exists per docs/database/74, but no
  refund flow is wired to any route yet — out of scope until a future
  round actually issues refunds).
- Shipment/tracking emails (§4.6 — blocked on the `external_mappings`
  linkage question, not an email-design problem).
- Marketing/newsletter email (already WordPress's `wp_mail()`, untouched by
  this design; see §1.3).
- Abandoned-cart / re-engagement email (not a transactional event tied to
  an order's own lifecycle; a distinct product decision, out of scope).

## 3. Design: domain event → outbox → template → provider adapter

```
 ┌─────────────────────────┐   same DB transaction    ┌──────────────────┐
 │ apply_verified_payment_  │ ───────────────────────▶ │ email_outbox      │
 │ transition / order status│   (INSERT, never a       │ (pending rows)    │
 │ transition SQL function  │    separate app-level     └────────┬─────────┘
 └─────────────────────────┘    step)                            │
                                                                   │ polled by
                                                                   ▼
                                                     ┌──────────────────────┐
                                                     │ email dispatch worker │
                                                     │ (bounded batch, time  │
                                                     │  budget — same shape  │
                                                     │  as reservationExpira-│
                                                     │  tionWorker.ts)       │
                                                     └──────────┬────────────┘
                                                                 │
                                            render template      │  mark row
                                            (server-side, no      │  sent/failed
                                            client dependency)    ▼
                                                     ┌──────────────────────┐
                                                     │ provider adapter      │
                                                     │ (Resend/Postmark/SES  │
                                                     │  — §6, open decision) │
                                                     └──────────────────────┘
```

### 3.1 Why an outbox, not a direct call from the request/transaction path

The one non-negotiable requirement (also stated explicitly in the task
brief): **an email failure must never roll back or block the order/payment
transaction that triggered it.** An outbox table is the standard way to
guarantee this, and it composes with a pattern this codebase has already
proven out for the exact same reason (`payment_events`, `order_status_
events`: append a durable row inside the same transaction as the state
change, do the "real" side effect — settlement confirmation, inventory
adjustment — as a separate, retryable step read from that row).

Concretely:

- The `INSERT INTO email_outbox (...)` happens **inside** the same SQL
  function/transaction as the order or payment state change (e.g. inside
  `apply_verified_payment_transition` for events 2–5, inside
  `submit_native_checkout` for event 1, inside whatever future cancellation
  entrypoint handles event 6). If that transaction commits, the outbox row
  exists. If it rolls back for any reason, the outbox row never existed —
  there is no code path where the order state changes but the outbox write
  doesn't, or vice versa, because they are the same `COMMIT`.
- The actual network call to the email provider happens **later**, in a
  separate process (the dispatch worker), reading already-committed outbox
  rows. That call can fail, time out, or the provider can be down entirely
  — none of it can touch `orders`, `payment_attempts`, or any other
  business table, because the worker's write surface is scoped to
  `email_outbox` alone (see §3.4's grant model).
- This mirrors `apply_verified_payment_transition`'s own relationship to
  inventory: the payment transition and the inventory confirm/release
  happen atomically together, but the *provider webhook that triggered the
  transition* was already a fully separate, already-committed fact by the
  time `apply_verified_payment_transition` runs. Email is the same shape,
  one hop further downstream.

### 3.2 `email_outbox` — schema sketch

```sql
create type email_kind as enum (
  'order_received', 'payment_pending_pix', 'payment_pending_boleto',
  'payment_approved', 'payment_failed', 'order_cancelled'
);
create type email_outbox_status as enum (
  'pending', 'sending', 'sent', 'failed', 'dead_letter'
);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  kind email_kind not null,
  -- Idempotency key: exactly one row may ever exist for a given
  -- (event_source, event_id, kind) triple. event_id is the natural key of
  -- whatever caused the enqueue — the order id itself for order_received/
  -- order_cancelled, the payment_attempt id for the four payment-status
  -- emails. This is what makes "never send the same email twice for the
  -- same event" a database constraint, not an application convention.
  event_source text not null,        -- 'order' | 'payment_attempt'
  event_id uuid not null,
  recipient_email text not null,     -- snapshot of orders.contact_email at
                                      -- enqueue time; never re-read from
                                      -- orders later (order data could
                                      -- change; the email must describe the
                                      -- state at the moment it was true)
  template_data jsonb not null,      -- pre-resolved values needed to render
                                      -- (order number, amount, pix copy-
                                      -- paste code, etc.) — captured now so
                                      -- the worker never has to re-query
                                      -- business tables that may have moved
                                      -- on by the time it runs
  status email_outbox_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  correlation_id uuid not null,      -- carried from the triggering
                                      -- payment_events/order_status_events
                                      -- row, for cross-table tracing
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  next_attempt_at timestamptz not null default now()
);

create unique index email_outbox_dedupe_unique
  on email_outbox (event_source, event_id, kind);
create index email_outbox_pending_idx
  on email_outbox (status, next_attempt_at, id)
  where status in ('pending', 'failed');
```

Design notes:

- **`template_data` is a snapshot, not a foreign-key lookup at send time.**
  This is deliberate, not an optimization. By the time the worker runs
  (seconds to minutes after enqueue, longer under backlog), the order could
  have been further mutated. The email must reflect the fact *as it was
  when the transition happened* (e.g., the amount that was actually
  charged), not whatever the row says now. This is the same "snapshot at
  the moment of truth" idiom `order_items` already uses
  (`productNameSnapshot`, `unitEffectiveAmountMinor`, etc. — captured at
  order-creation time, never re-joined against live catalog data).
- **The unique index is the real idempotency guarantee**, not
  application-level "check before insert" logic — the same idiom
  `payment_attempts_idempotency_unique` and `payment_events_external_
  dedupe_unique` already use. A duplicate enqueue attempt (e.g., a retried
  webhook that re-runs `apply_verified_payment_transition` and lands on
  `duplicate_ignored`, or a manual replay) either doesn't reach the insert
  at all (guarded by the same `processing_result` check that already
  exists) or hits the unique constraint and is a no-op.
- **`status` transitions (`pending → sending → sent`/`failed`) are owned
  exclusively by the dispatch worker**, never by request-path code. No
  route ever writes to `email_outbox.status`.
- **`dead_letter`** is reached after a bounded retry count (proposed: 8
  attempts with exponential backoff via `next_attempt_at`, capped around
  24h total), at which point the row stops being picked up automatically
  and becomes an operational/alerting concern, not a silent drop.

### 3.3 Where each event's outbox row gets inserted

| Event | Insert site |
|---|---|
| Order received | Inside `submit_native_checkout`, immediately after the order row is created, in the same transaction. |
| Pix/boleto pending | Inside whichever function transitions `payment_attempts.status` to `pending` (today: `transitionNativePaymentAttempt` / the SQL it wraps) — gated on `method`. |
| Payment approved | Inside `apply_verified_payment_transition`, in the branch where `resulting_status = 'paid'`. |
| Payment failed | Inside `apply_verified_payment_transition`, in the branch where `resulting_status = 'failed'` — see §2.1 for the per-attempt (not per-event) scoping. |
| Order cancelled | Inside the future cancellation entrypoint, when `orders.status` transitions to `cancelled`. No such entrypoint exists yet in the codebase as of this round — this row is a design placeholder, not a claim that cancellation is wired today. |

This keeps every enqueue colocated with the exact `SECURITY DEFINER`
function that already owns the transaction boundary, rather than adding a
second, independent write path that could drift out of sync with the
state machine.

### 3.4 Dispatch worker — shape, reusing the existing pattern

Same shape as `lib/commerce/reservationExpirationWorker.ts`: a bounded
batch loop with a time budget, not wired to any scheduler/cron route by
this design (that wiring is a separate, future, explicitly-authorized
step — exactly the posture docs/database/80 already took for reservation
expiration).

```ts
// lib/commerce/emailDispatchWorker.ts (future file — sketch only)
export interface EmailDispatchSummary {
  batches: number;
  sent: number;
  failed: number;
  deadLettered: number;
  truncated: boolean;
  durationMs: number;
}

export interface ProcessPendingEmailsOptions {
  batchSize?: number;
  timeBudgetMs?: number;
  now?: () => number;
  claimBatch?: (batchSize: number) => Promise<EmailOutboxRow[]>;
  send?: (row: EmailOutboxRow) => Promise<void>; // provider adapter call
}
```

For each claimed row: render the template server-side (no client-side
dependency — templates are plain functions returning `{ subject, html,
text }` from `template_data`, no React-email-in-the-browser concern since
nothing here runs client-side), call the provider adapter, and mark the row
`sent` or `failed`/`dead_letter`. **A send failure updates only
`email_outbox`.** It has no code path back into `orders`, `payment_
attempts`, or any order-affecting table — the worker's DB role should be
granted `UPDATE` on `email_outbox` only, not on any commerce table, so this
isolation is enforced at the database-privilege level, not just by
"the code doesn't happen to write there today" (the same posture
docs/database/78 §2 uses for `persi_worker` vs. `persi_app` grants).

Claiming a batch should use `SELECT ... FOR UPDATE SKIP LOCKED` (or
equivalent) on `status = 'pending' AND next_attempt_at <= now()`, so
multiple worker instances (if ever run concurrently) never double-send the
same row — belt-and-suspenders on top of the provider-level idempotency
key described next.

### 3.5 Provider-level idempotency, not just outbox-level

Most transactional-email providers (Resend, Postmark, SES via a
configuration-set idempotency token) accept a client-supplied idempotency
key on the send call itself. The adapter should pass `email_outbox.id`
(the outbox row's own UUID) as that key. This means even if the worker
crashes *after* the provider accepted the send but *before* it marks the
row `sent` (leaving it `sending` or `pending` for a retry), the retried
send is a safe no-op at the provider, not a duplicate email in the
customer's inbox. This is the second half of "never send the same email
twice" — the outbox unique index prevents enqueuing the same logical event
twice; the provider idempotency key prevents the transport-level retry
from re-delivering.

## 4. Failure-isolation guarantee, stated explicitly

The brief asks for this to be concrete, so restating it plainly:

1. Order/payment state changes happen in `orders`/`payment_attempts` and
   commit as part of an existing `SECURITY DEFINER` function
   (`submit_native_checkout`, `apply_verified_payment_transition`, or a
   future cancellation equivalent).
2. The `email_outbox` row for that event is inserted **inside that same
   transaction**. Either both commit or neither does — there is no
   intermediate state where the order changed but no outbox row exists, or
   an outbox row exists for an order change that got rolled back.
3. Once committed, the outbox row is inert data. Nothing about sending the
   email is synchronous with, or capable of blocking, the request/webhook
   handler that caused the transition — the HTTP response to the checkout
   submission or payment webhook returns as soon as step 1–2's transaction
   commits, with zero dependency on network reachability to any email
   provider.
4. The dispatch worker is a fully separate process/invocation that only
   ever writes to `email_outbox`. A provider outage, malformed template
   data, rate limit, or bug in the adapter can only ever produce
   `email_outbox.status = 'failed'`/`'dead_letter'` rows — there is no code
   path from the worker back into `orders` or `payment_attempts`, both
   because the design routes it that way and because the worker's DB
   grants should not include `UPDATE`/`INSERT` on those tables at all.

## 5. What "v1" means in scope terms

**In scope for a future implementation round:**

- `email_outbox` migration + Drizzle schema (new `lib/db/schema/
  emails.ts`, exported from `lib/db/schema/index.ts`).
- Outbox-insert additions to `submit_native_checkout` and
  `apply_verified_payment_transition` (both already exist; this is an
  addition inside existing functions, not new entrypoints).
- `emailDispatchWorker.ts` (bounded batch, no scheduler wiring — same
  posture as `reservationExpirationWorker.ts`).
- Six plain-function templates (order received, pix pending, boleto
  pending, payment approved, payment failed, order cancelled), each a pure
  `(templateData) => { subject, html, text }` with no external dependency.
- One provider adapter module behind a narrow interface (`send(row):
  Promise<void>`), gated by `assertExternalWriteAllowed` the same way every
  other real-provider call in this codebase already is
  (`lib/runtime/external-write-guard.ts`), so a misconfigured
  staging/local environment cannot accidentally send real customer email
  any more than it can accidentally charge a real card today.

**Explicitly not in scope for v1** (see §2.2 and §4.6): refunds, shipment/
tracking, marketing/re-engagement email, any scheduler/cron wiring, any
actual provider account or API key, any code change of any kind in this
round.

### 4.6 Why shipment/tracking is blocked, not just deferred

Unlike the other events, this isn't a prioritization choice — the data
model doesn't yet answer where a *native* order's shipment lives.
`shipments.orderMappingId` is a composite FK into `external_mappings`
(`entity_type = 'order'`), a table built for reconciling WooCommerce/Olist
order identities across external systems (docs/database/07,
`lib/db/schema/integrations.ts`). Whether native orders get their own
`external_mappings` row (so this FK "just works"), or need a parallel
`orders.id`-keyed shipment linkage, is a modeling decision for whichever
future round actually wires native-commerce shipping — not something this
email-design round should resolve as a side effect. Until that's decided,
a shipment-status email trigger has no stable table to key off for native
orders specifically, so it stays out of v1.

## 6. Provider choice — open, needs a business decision

This is explicitly **not** this document's decision to make (deliverability
reputation, cost at Persi's order volume, and existing vendor relationships
are business inputs this round has no visibility into). A short, reasoned
shortlist, for whoever does make the call:

| Provider | Brazil/.com.br fit | Notes |
|---|---|---|
| **Resend** | Good — straightforward domain verification (SPF/DKIM/DMARC via DNS TXT records on `persimateriais.com.br`, same pattern as any provider), React-email-friendly templating if ever wanted, generous free tier for early volume. Newer company; smaller track record than the alternatives at high volume. | Simplest integration surface; the "shortest path to v1" candidate. |
| **Postmark** | Good — long-standing reputation specifically for transactional (not bulk) email, strict anti-spam posture keeps deliverability high, per-message-type stream separation (useful for separating order-confirmation-critical mail from anything lower priority later). Historically pricier per email than Resend at volume. | Best deliverability track record for exactly this use case; worth it if delivery reliability outweighs cost. |
| **AWS SES** | Good but more setup — SPF/DKIM/DMARC configuration is the same DNS work either way, but SES itself requires production-access approval (new accounts start in a sending sandbox restricted to verified recipients only) and more manual bounce/complaint-handling wiring. Cheapest at volume by a wide margin. | Makes sense if Persi's infrastructure is already AWS-heavy or volume gets large enough for cost to dominate; more operational overhead to reach parity with the other two out of the box. |

None of these should be treated as a foregone conclusion. Whatever is
chosen, the adapter interface in §5 (`send(row): Promise<void>`, gated by
`assertExternalWriteAllowed`) is designed so swapping providers later is a
single-module change, not a redesign — the outbox, idempotency, and
failure-isolation guarantees in §3–4 hold regardless of which provider
sits behind the adapter.

## 7. Non-goals restated

- No code was written, no migration was created, no `package.json` entry
  was added, no npm install was run.
- No real email was sent; no live SMTP/provider API was called.
- No new business status/enum value was invented — every trigger in §2
  maps to an enum value that already exists in `lib/db/schema/payments.ts`
  or `lib/db/schema/orders.ts` today.
- No claim is made that any part of this pipeline is wired, scheduled, or
  reachable from any route. Everything in §3–5 is a sketch for a future,
  separately-authorized implementation round to build and locally qualify
  before any shadow/canary exposure, following the same discipline as
  every native-commerce round before it.
