# B.3-C3-P2-A — Persi store bootstrap preparation

## Scope and result

This phase prepared and validated the controlled bootstrap script. It did not execute
the bootstrap in `persi-staging`: the only remote operation was the script's default
read-only dry-run. No backup, migration, seed, store, assignment or other remote row was
created. Production was not accessed.

The verified staging target is `persi-staging`, project ref
`vtrujmhhkmvjzfklzxip`, with 23 migrations through
`20260903120000_store_price_authority_foundation.sql`.

## Immutable intended identity

The proposed store is:

- code `persi`;
- name `Persi Materiais de Construção`;
- status `active`;
- default currency `BRL`;
- timezone `America/Sao_Paulo`;
- initial order sequence `1`.

The proposed authority assignment is:

- price-list code `woo-brl`;
- price-list UUID `bc5547d9-b7ff-4714-84e4-c9cb149b7408`;
- currency `BRL`;
- commercial context `storefront_retail`;
- version `1`;
- `valid_from = transaction_timestamp()`;
- `valid_to = NULL`.

PostgreSQL generates the store and assignment UUIDs only inside a future authorized
transaction. They are not derived from WooCommerce, Olist, a hostname or the display
name.

## Script and safe usage

The server-only script is `scripts/database/bootstrap-persi-store.mjs`. With no flags it
targets only the hard-coded staging project identity and runs inside a read-only
transaction:

```text
node scripts/database/bootstrap-persi-store.mjs
```

Local apply testing uses the local flag. A future staging write requires both flags
below and a separate, phase-specific authorization; this command was not executed in
P2-A:

```text
node scripts/database/bootstrap-persi-store.mjs --apply --confirm=persi-store-bootstrap
```

`--apply` without the exact confirmation fails with
`APPLY_CONFIRMATION_REQUIRED`. Confirmation without `--apply` fails with
`APPLY_FLAG_REQUIRED`. Unknown arguments fail closed. The remote connection template
must contain the exact project ref and must not identify production. Credentials are
loaded server-side and never reported.

## Transaction, lock and idempotency

Apply mode uses one database transaction and a transaction-scoped advisory lock for
`persi-store-bootstrap`. Before inserting, it verifies the exact migration head, the
double identity of the price list, its active BRL/storefront contract, current price
coverage and the P1 resolver.

The only permitted mutations are one `stores` INSERT and one
`store_price_list_assignments` INSERT. The script then resolves and compares the new
authority and checks that all catalog, pricing, inventory, customer, cart, checkout,
order, PIM, media, mapping and shipping table counts remain unchanged. Any error rolls
back the complete transaction.

An exact rerun returns `ALREADY_BOOTSTRAPPED` with zero writes. A differing identity,
duplicate assignment or unexpected history fails as `BOOTSTRAP_CONFLICT`; the script
does not update the store, create version 2 or select another price list. The advisory
lock makes concurrent apply attempts serialize.

## Coverage and validation evidence

The staging dry-run returned `READY_TO_APPLY`, zero writes, zero matching stores and zero
assignments. It verified `woo-brl` as active BRL/storefront and found 3,080 eligible
variants, 3,080 uniquely priced variants, zero missing prices, zero ambiguous prices,
zero invalid-currency prices and 186 currently valid sale prices.

The focused local suite passed 13/13 tests: read-only dry-run, first apply, exact rerun,
conflicts, wrong identity/UUID/currency/channel/status, missing and ambiguous coverage,
transaction rollback, unchanged runtime configuration, and 20 concurrent cycles. Every
concurrency cycle ended with exactly one store, one version-1 assignment, no duplicate
and no partial bootstrap.

Relevant regressions also passed: 391/391 pgTAP assertions; PIM, pricing and inventory;
50 inventory concurrency cycles with zero overselling; P1/C1/C2 static validation
30/30; and native checkout/order runtime tests 7/7.

## Runtime boundary

Creating an active store is a resolver prerequisite, not a runtime switch.
`CATALOG_DATA_SOURCE` remains WooCommerce by default. Native cart, checkout and order
remain disabled, and no frontend, WooCommerce, Olist, PIM or external mapping was
changed.

## Store DML security debt

The existing B3-A grants permit `persi_app` and `persi_worker` to select, insert and
update `stores`; their current policies also permit those operations. Browser roles
have no grants, and the read-only role has SELECT only. This debt does not block a
privileged, controlled bootstrap, but it blocks runtime activation.

Before native runtime, introduce a separately reviewed migration that revokes store
INSERT/UPDATE from normal application and worker roles and replaces permissive DML
policies with the least-privilege SELECT policies actually required. Bootstrap must
continue to use a privileged administrative connection rather than a public route.

## PII prerequisite

The separately designed encrypted, server-only checkout contact/address envelope is
still required before C3 transaction integration. It was not implemented in this phase.

## Rollback and future authorization

Before any real bootstrap, create and verify a fresh staging backup labelled
`pre-persi-store-bootstrap`. The preferred rollback is restoration from that backup
while native runtime is disabled. Do not implement or perform an automatic DELETE:
assignment history is protected and an uncertain execution must first be reconciled in
read-only mode.

Real execution requires new explicit authorization naming the exact target, project ref,
script path and final SHA-256, intended identity and authority, exactly two expected
INSERTs, and the continued production prohibition. A code change invalidates the hash
and therefore invalidates that authorization.

## Authorized staging execution — P2-B

The authorized bootstrap completed once on 2026-09-03 against `persi-staging`
(`vtrujmhhkmvjzfklzxip`, PostgreSQL 17.6). The script SHA-256 matched
`440600afeb6789545959d113545d0ec4b4b943f880654327b859bac66de31bd9`.

The fresh recovery point is
`D:\persi-backups\staging\20260903-212817-pre-persi-store-bootstrap`: five files,
22,245,337 total bytes and all hashes revalidated. The manifest SHA-256 is
`1a810b347520a691094e7746aeb70cd257648e8e69cd0036f55eb1b4b668d88e`.

The single apply transaction reported exactly two writes and created store UUID
`7aaaa9ec-14e5-48f7-9de5-3630d92c5483` and assignment UUID
`846f4766-8aab-4889-a7a7-f6bd17fab830`, valid from
`2026-09-04T00:30:25.970Z` with no end. The read-only audit resolved that exact version-1
assignment to price list `bc5547d9-b7ff-4714-84e4-c9cb149b7408`.

Only `stores` and `store_price_list_assignments` changed from zero to one. Price,
catalog, inventory, transactional commerce, PIM, media, mappings and shipping remained
unchanged. The final dry-run returned `ALREADY_BOOTSTRAPPED` with zero writes. Native
runtime remains disabled; store DML hardening and the encrypted checkout PII envelope
remain separate prerequisites, so C3 transaction integration is not ready.
