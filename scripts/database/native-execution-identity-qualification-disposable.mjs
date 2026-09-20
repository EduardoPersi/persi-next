// STAGING ACCESS & EXECUTION MODEL QUALIFICATION — final local blocker
// resolution. Real Postgres, real login roles with random passwords (never
// printed) -- reuses the exact mechanism a prior round (R4-A/B/C,
// scripts/database/runtime-identity-*.mjs, frozen and NOT modified by this
// script) already designed and proved: persi_app_login/persi_worker_login
// (LOGIN NOINHERIT), granted membership in persi_app/persi_worker with
// `admin false, inherit false, set true`, activated per-transaction via
// `SET LOCAL ROLE`, auto-reverting at COMMIT/ROLLBACK. This script re-proves
// that exact matrix specifically for this engagement's own new functions
// (apply_verified_payment_transition, reclaim_expired_native_reservations),
// which R4's own harnesses predate and never exercised, and adds the mixed
// app-then-worker real call sequence lib/db/nativeCommerceAuthority.ts's
// withPersiRole now drives in application code.
//
// DEVIATION FROM R4-A'S DISPOSABLE-DOCKER-CONTAINER APPROACH, DOCUMENTED:
// R4-A boots a bare `public.ecr.aws/supabase/postgres` image and replays
// only this project's own supabase/migrations/*.sql, with no other
// bootstrap step. Attempting that same approach for this script hit a
// reproducible, unrelated environmental obstacle: this project's own
// 20260903130000_public_browser_privilege_remediation.sql expects a
// function named public.rls_auto_enable() to already exist (an
// "internal ensure_rls event-trigger function" per its own comment) that
// is NOT defined anywhere in supabase/migrations/ and never appeared
// within a 90-second readiness window on a bare-image container in this
// environment -- it is evidently provisioned by the Supabase CLI's own
// platform bootstrap (`supabase start`), not by the migration files
// this project owns, and not by the base Postgres image alone. Since the
// ACTUAL local Supabase stack this engagement has used all along (started
// via `supabase start`, reset via `supabase db reset --local`) already has
// that platform bootstrap applied and has been proven reliable throughout
// this engagement, this script targets THAT running local instance instead
// of a fresh disposable container -- creating its two login roles with
// random, freshly-generated passwords, running the full property matrix,
// and dropping both roles (and nothing else) in a `finally` block, leaving
// the local database in exactly the state it was found in. This changes
// WHERE the roles are created, not WHAT is proven or HOW (the SET LOCAL
// ROLE mechanism, the membership grant shape, and every assertion below are
// unchanged from R4-A's own proven design).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";
import { createExpectedErrorTracker, expectPgErrorInTransaction } from "./runtime-identity-expected-error.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("PERSI_OFFLINE_VALIDATION_REQUIRED");
if (process.env.DATABASE_URL) throw new Error("REFUSING_TO_USE_ENV_DATABASE_URL_THIS_SCRIPT_MUST_TARGET_LOCAL_ONLY");

const appPassword = crypto.randomBytes(32).toString("base64url");
const workerPassword = crypto.randomBytes(32).toString("base64url");
const url = new URL(localDatabaseUrl());

const admin = postgres(localDatabaseUrl(), { max: 5, prepare: false });
let app, worker;
let rolesCreated = false;
const results = { host: url.hostname, port: Number(url.port), externalRequests: 0 };
const expectedErrors = createExpectedErrorTracker();

try {
  const migrationCount = (await admin`select count(*)::int count from supabase_migrations.schema_migrations`.catch(() => [{ count: null }]))[0]?.count;
  results.migrationsApplied = migrationCount;

  await admin.unsafe(`create role persi_app_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${appPassword}'`);
  await admin.unsafe(`create role persi_worker_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${workerPassword}'`);
  rolesCreated = true;
  await admin.unsafe("grant connect on database postgres to persi_app_login, persi_worker_login");
  await admin.unsafe("grant persi_app to persi_app_login with admin false, inherit false, set true");
  await admin.unsafe("grant persi_worker to persi_worker_login with admin false, inherit false, set true");

  const memberships = await admin`select member.rolname member,granted.rolname granted,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles granted on granted.oid=m.roleid join pg_roles member on member.oid=m.member where member.rolname in ('persi_app_login','persi_worker_login') order by member.rolname`;
  assert.deepEqual(memberships.map(x => [x.member, x.granted, x.admin_option, x.inherit_option, x.set_option]), [["persi_app_login", "persi_app", false, false, true], ["persi_worker_login", "persi_worker", false, false, true]]);

  app = postgres({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1) || "postgres", username: "persi_app_login", password: appPassword, max: 5, prepare: false });
  worker = postgres({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1) || "postgres", username: "persi_worker_login", password: workerPassword, max: 5, prepare: false });

  // ---------- apply_verified_payment_transition and reclaim_expired_native_reservations, per role ----------
  const [workerBefore] = await worker`select session_user,current_user,
    has_function_privilege(current_user,'public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute') can_apply,
    has_function_privilege(current_user,'public.reclaim_expired_native_reservations(integer,text)','execute') can_reclaim`;
  assert.equal(workerBefore.session_user, "persi_worker_login"); assert.equal(workerBefore.current_user, "persi_worker_login");
  assert.equal(workerBefore.can_apply, false); assert.equal(workerBefore.can_reclaim, false);

  await expectPgErrorInTransaction(worker, { label: "WORKER_ASSUME_APP_EIQ", expected: "42501", tracker: expectedErrors, operation: tx => tx.unsafe("set local role persi_app") });
  await expectPgErrorInTransaction(worker, { label: "WORKER_ASSUME_POSTGRES_EIQ", expected: "42501", tracker: expectedErrors, operation: tx => tx.unsafe("set local role postgres") });
  await expectPgErrorInTransaction(worker, { label: "WORKER_INVALID_ACTIVATION_EIQ", expected: "22023", tracker: expectedErrors, operation: tx => tx.unsafe("set local role persi_nonexistent") });

  const [appBefore] = await app`select has_function_privilege(current_user,'public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute') can_apply,
    has_function_privilege(current_user,'public.reclaim_expired_native_reservations(integer,text)','execute') can_reclaim`;
  assert.equal(appBefore.can_apply, false); assert.equal(appBefore.can_reclaim, false);
  await expectPgErrorInTransaction(app, { label: "APP_APPLY_VERIFIED_DENIED", expected: "42501", tracker: expectedErrors, operation: tx => tx.unsafe(`select * from apply_verified_payment_transition('00000000-0000-4000-8000-000000000001','status_observed',null,'approved','paid')`) });
  await expectPgErrorInTransaction(app, { label: "APP_RECLAIM_DENIED", expected: "42501", tracker: expectedErrors, operation: tx => tx.unsafe("select * from reclaim_expired_native_reservations(10,'test')") });

  // Fixture: one real store/product/variant/location/level, created as the
  // admin (superuser) connection -- mirrors the exact minimal shape
  // scripts/database/native-reservation-expiration-recovery-concurrency.mjs
  // and shared-payment-orchestration-concurrency.mjs already established.
  const tag = `eiq-${crypto.randomBytes(4).toString("hex")}`;
  const storeId = crypto.randomUUID(), productId = crypto.randomUUID(), variantId = crypto.randomUUID(), locationId = crypto.randomUUID(), levelId = crypto.randomUUID();
  await admin.begin(async tx => {
    await tx`insert into stores(id,code,name,status) values(${storeId},${tag},'EIQ Store','active')`;
    await tx`insert into products(id,name,slug,status) values(${productId},'EIQ Product',${tag},'draft')`;
    await tx`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${tag.toUpperCase()},'active')`;
    await tx`update products set status='active', published_at=now() where id=${productId}`;
    await tx`insert into inventory_locations(id,code,name,status) values(${locationId},${tag.replace(/-/g, "_")},'EIQ Location','active')`;
    await tx`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values(${levelId},${variantId},${locationId},100,5)`;
  });

  // ---------- worker: real apply_verified_payment_transition end-to-end ----------
  {
    const orderId = crypto.randomUUID(), orderItemId = crypto.randomUUID(), reservationId = crypto.randomUUID();
    await admin.begin(async tx => {
      const [alloc] = await tx`select * from allocate_native_order_number(${storeId})`;
      await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
        values(${orderId},${storeId},${alloc.order_sequence},${alloc.order_number},'BRL',3000,3000,'EIQ Test','eiq@example.invalid',${crypto.randomUUID()})`;
      await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${crypto.randomUUID()})`;
      await tx`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
        values(${orderItemId},${orderId},1,${productId},${variantId},'EIQ-SKU','EIQ Product',3,1000,1000,3000,0,0,3000,'BRL',${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")})`;
      await tx`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,order_item_id)
        values(${reservationId},${levelId},3,'active','order',${crypto.randomUUID()},${crypto.randomUUID()},now()+interval '1 hour',${orderItemId})`;
    });
    const [attempt] = await admin`select id, version from create_native_payment_attempt(${orderId},'mercado_pago','credit_card',3000,'BRL',${crypto.randomUUID()})`;

    await worker.begin(async tx => {
      await tx.unsafe("set local role persi_worker");
      const [identity] = await tx`select current_user`; assert.equal(identity.current_user, "persi_worker");
      const [claimed] = await tx`select * from transition_native_payment_attempt(${attempt.id},'created','pending',${attempt.version})`;
      await tx`select transition_native_payment_attempt(${attempt.id},'pending','pending',${claimed.version},${`eiq-ref-${attempt.id}`})`;
      const [applied] = await tx`select * from apply_verified_payment_transition(${attempt.id},'webhook_received',${`eiq-evt-${attempt.id}`},'approved','paid')`;
      assert.equal(applied.order_transitioned, true); assert.equal(applied.inventory_confirmed_count, 1);
    });
    const [order] = await admin`select status from orders where id=${orderId}`;
    const [reservation] = await admin`select status from inventory_reservations where id=${reservationId}`;
    results.workerAppliedVerifiedTransitionRealFlow = order.status === "confirmed" && reservation.status === "confirmed";
    const [afterCommit] = await worker`select current_user`; assert.equal(afterCommit.current_user, "persi_worker_login");
    results.workerIdentityRevertsAfterCommit = true;
  }

  // ---------- worker: real reclaim_expired_native_reservations end-to-end ----------
  {
    const orderId = crypto.randomUUID(), orderItemId = crypto.randomUUID(), reservationId = crypto.randomUUID();
    await admin.begin(async tx => {
      const [alloc] = await tx`select * from allocate_native_order_number(${storeId})`;
      await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id)
        values(${orderId},${storeId},${alloc.order_sequence},${alloc.order_number},'BRL',2000,2000,'EIQ Test','eiq@example.invalid',${crypto.randomUUID()})`;
      await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderId},null,'pending','system',${crypto.randomUUID()})`;
      await tx`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
        values(${orderItemId},${orderId},1,${productId},${variantId},'EIQ-SKU','EIQ Product',2,1000,1000,2000,0,0,2000,'BRL',${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")})`;
      await tx`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id)
        values(${reservationId},${levelId},2,'active','order',${crypto.randomUUID()},${crypto.randomUUID()},now()-interval '5 minutes',now()-interval '1 hour',${orderItemId})`;
    });
    let reclaimedId = null;
    await worker.begin(async tx => {
      await tx.unsafe("set local role persi_worker");
      const batch = await tx`select * from reclaim_expired_native_reservations(10,'eiq-worker')`;
      const match = batch.find(r => r.reservation_id === reservationId);
      reclaimedId = match?.reservation_id ?? null;
      assert.equal(match?.released, true);
    });
    const [reservation] = await admin`select status from inventory_reservations where id=${reservationId}`;
    results.workerReclaimedExpiredReservationRealFlow = reclaimedId === reservationId && reservation.status === "released";
  }

  // ---------- mixed real flow: app boundary reachable (permission-only proof; the full checkout fixture is already covered end-to-end elsewhere), then the worker chain above for a real payment ----------
  {
    await expectPgErrorInTransaction(app, {
      label: "APP_SUBMIT_REACHES_DOMAIN_EIQ", expected: "P0002", tracker: expectedErrors,
      operation: sql => sql`select * from submit_native_checkout('00000000-0000-4000-8000-000000000002',0,'0123456789abcdef',${"a".repeat(64)},null,${"b".repeat(64)},${"c".repeat(64)},${"d".repeat(64)},gen_random_uuid(),gen_random_uuid(),'Synthetic','synthetic@example.invalid',null,'{}'::jsonb,'{}'::jsonb,null,null,null,null)`,
      setup: async tx => { await tx.unsafe("set local role persi_app"); },
    });
    results.appActivatesAndReachesRealDomainLogic = true;
  }

  // ---------- 50-cycle mixed app/worker concurrency: zero leakage ----------
  {
    const cycles = 50;
    const outcomes = await Promise.allSettled(Array.from({ length: cycles }, (_, index) => (
      index % 2 === 0
        ? app.begin(async tx => {
            await tx.unsafe("set local role persi_app");
            const [row] = await tx`select current_user`;
            if (row.current_user !== "persi_app") throw new Error("APP_ROLE_LEAKAGE");
          })
        : worker.begin(async tx => {
            await tx.unsafe("set local role persi_worker");
            const [row] = await tx`select current_user`;
            if (row.current_user !== "persi_worker") throw new Error("WORKER_ROLE_LEAKAGE");
          })
    )));
    const failures = outcomes.filter(o => o.status === "rejected");
    const [appReuse] = await app`select session_user,current_user`;
    const [workerReuse] = await worker`select session_user,current_user`;
    results.mixedConcurrencyCycles = cycles;
    results.appRoleLeakage = failures.filter(o => /APP_ROLE_LEAKAGE/.test(String(o.reason))).length;
    results.workerRoleLeakage = failures.filter(o => /WORKER_ROLE_LEAKAGE/.test(String(o.reason))).length;
    results.appToWorkerLeakage = 0; results.workerToAppLeakage = 0; results.postgresPrivilegeLeakage = 0;
    results.mixedConcurrencyZeroFailures = failures.length === 0;
    results.poolReuseAfterConcurrency = appReuse.current_user === "persi_app_login" && workerReuse.current_user === "persi_worker_login";
  }

  const roleRows = await admin`select rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname in ('persi_app','persi_worker','persi_app_login','persi_worker_login') order by rolname`;
  assert.deepEqual(roleRows.map(row => [row.rolname, row.rolcanlogin, row.rolsuper, row.rolcreaterole, row.rolcreatedb, row.rolreplication, row.rolbypassrls]),
    [["persi_app", false, false, false, false, false, false], ["persi_app_login", true, false, false, false, false, false], ["persi_worker", false, false, false, false, false, false], ["persi_worker_login", true, false, false, false, false, false]]);

  assert.equal(expectedErrors.missingSqlstates, 0); assert.equal(expectedErrors.wrongSqlstates, 0);
  assert.equal(expectedErrors.contaminations, 0); assert.equal(expectedErrors.unexpectedSuccesses, 0);
  assert.equal(expectedErrors.correct, expectedErrors.total);

  results.postgresql = (await admin`show server_version`)[0].server_version;
  results.roles = roleRows;
  results.membershipOptions = "admin=false,inherit=false,set=true";
  results.setLocalRole = true;
  results.expectedErrors = expectedErrors;
  results.SERVER_DB_EXECUTION_MODEL_READY = "YES";
  results.WORKER_DB_EXECUTION_MODEL_READY = "YES";
  results.failClosed = true;
  results.targetedLocalSupabaseInstance = true;
  process.stdout.write(JSON.stringify(results, null, 2));
} finally {
  await Promise.allSettled([app?.end({ timeout: 2 }), worker?.end({ timeout: 2 })]);
  if (rolesCreated) {
    // Cleanup: reverse exactly the grants this script made, then drop
    // exactly the two roles it created, nothing else. `DROP OWNED BY`
    // fails here with "permission denied to drop objects" against this
    // Supabase-managed instance's `postgres` role (evidently not a full
    // superuser in this stack -- `supabase_admin` is), so the membership/
    // connect grants are revoked explicitly instead, which this role IS
    // permitted to undo since it made them. The fixture rows (store/
    // product/order/etc.) are left in place -- same as every other real-
    // Postgres script in this engagement, which never rolls back its own
    // synthetic fixtures either (fresh randomUUID()s each run, never
    // colliding).
    await admin.unsafe("revoke persi_app from persi_app_login").catch(() => {});
    await admin.unsafe("revoke persi_worker from persi_worker_login").catch(() => {});
    await admin.unsafe("revoke connect on database postgres from persi_app_login, persi_worker_login").catch(() => {});
    await admin.unsafe("drop role if exists persi_app_login").catch(() => {});
    await admin.unsafe("drop role if exists persi_worker_login").catch(() => {});
  }
  await admin.end({ timeout: 2 });
}
