# M29-R3 — initial order-event constraint remediation

Date: 2026-09-06. Local, strictly offline and disposable only.

## Root cause and catalog proof

Canonical S0 was PostgreSQL 17.6 at `127.0.0.1:15422`, 29 migration files, history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`.

M26 creates two constraint triggers using `enforce_native_order_initial_event()`:

- `orders_initial_event_required`, AFTER INSERT on `orders`, DEFERRABLE INITIALLY DEFERRED;
- `order_events_initial_exact`, AFTER INSERT on `order_status_events`, DEFERRABLE INITIALLY DEFERRED, with `WHEN (new.from_status is null)`.

Read-only catalog inspection proved both names in `pg_trigger` and `pg_constraint`. Their `tgconstraint` values were nonzero; both were deferrable and initially deferred. M29 nevertheless received `42704` because `submit_native_checkout` has `SET search_path=''` and used unqualified constraint names.

A read-only transaction proved that, with an empty search path, `SET CONSTRAINTS public.orders_initial_event_required, public.order_events_initial_exact IMMEDIATE` resolves successfully. Thus the constraints are selectively addressable when schema-qualified. `SET CONSTRAINTS ALL` was unnecessary and was not used.

## Correction

M29 changed only:

```sql
set constraints public.orders_initial_event_required,public.order_events_initial_exact immediate;
```

M26–M28 were not changed, M30 was not created, and deferred behavior was not broadened. The M26 function continues to require exactly one event with `from_status IS NULL`, `to_status='pending'` and `actor_type='system'`.

## Disposable runtime proof

A fresh PostgreSQL 17.6 Supabase container used the local image, `--pull never`, loopback dynamic port and tmpfs. Migrations 1–29 applied. Authentic `persi_app_login -> BEGIN -> SET LOCAL ROLE persi_app -> submit_native_checkout` completed successfully.

The resulting aggregate had:

- one pending order, number ending `000001`;
- one order item and two immutable addresses;
- exactly one NULL-to-pending system event;
- cart `converted`;
- checkout `order_created` with no persistent `submitting` state;
- temporary checkout PII cleared;
- one linked active reservation;
- zero sale movements.

The flow also reconfirmed R1/R2 contracts: `default_currency`, cart snapshot `1` versus locked version `2`, `storefront_retail`, resolver list/effective values 1000 and valid fingerprint.

Negative invariant tests passed:

- missing initial event failed at deferred enforcement with `23514 / ORDER_INITIAL_EVENT_REQUIRED`;
- duplicate initial event failed with `23505` on `order_status_events_initial_unique`;
- wrong NULL-to-confirmed event failed with `23514` on `order_status_events_initial_exact_check`;
- negative-test order residue was zero.

Submission created no new reservation movement or sale movement and changed neither on-hand nor reserved quantity. The reservation remains active because payment/confirmation is out of scope.

## Quality, hashes and cleanup

Focused M29, order, identity, SQLSTATE, readiness and offline regression tests passed 57/57. Typecheck, lint and `git diff --check` passed. Offline build remained independently blocked by the existing Google Inter `next/font` fetch dependency; the offline guard recorded zero actual external requests.

- pre-R3 M29: `8b8575e7df28a8e6f676e7569b370e69cf2ca219273d789f9ec86c1d784fb8d8`;
- post-R3 candidate: `1cb4f4d50377270c999d87025774211d15c444bb15caae670101fa3166b44ee4`.

Protected P3-A/P3-B/M26/M27/M28 hashes remained unchanged. The disposable container/tmpfs was removed. Canonical S1 remained history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`.

No external provider, staging or production was accessed. No canonical reset/truncate, runtime activation, commit or push occurred. M29-R3 passes and is safe to request a fresh R4-C restart; R4-C was not started here.
