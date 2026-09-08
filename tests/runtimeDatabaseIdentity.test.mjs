import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source=readFileSync("scripts/database/runtime-identity-disposable.mjs","utf8");
test("identity harness is offline, local-image-only and disposable",()=>{assert.match(source,/PERSI_OFFLINE_VALIDATION/);assert.match(source,/--pull", "never/);assert.match(source,/--tmpfs/);assert.match(source,/127\.0\.0\.1/);assert.match(source,/docker", \["rm", "-f"/);});
test("credentials are random, distinct and never emitted",()=>{assert.match(source,/randomBytes\(32\)/);assert.doesNotMatch(source,/results\.(adminPassword|appPassword|workerPassword)/);});
test("roles are isolated and activated transactionally",()=>{assert.match(source,/noinherit password/);assert.match(source,/inherit false, set true/);assert.match(source,/set local role persi_app/);assert.match(source,/set local role persi_worker/);assert.match(source,/set local role postgres/);});
test("canonical database port is never targeted",()=>{assert.doesNotMatch(source,/15422/);});
test("project migrations are gated by semantic readiness",()=>{assert.ok(source.indexOf("waitForSemanticReadiness")<source.indexOf("const migrationFiles"));assert.match(source,/requiredSuccesses: 3/);assert.match(source,/timeoutMs: 90000/);assert.match(source,/PostgreSQL init process complete/);});
test("expected PostgreSQL errors are isolated and 25P02 is rejected",()=>{assert.match(source,/expectPgErrorAtSavepoint/);assert.match(source,/expectPgErrorInTransaction/);assert.match(source,/expectedErrors\.contaminations,0/);assert.doesNotMatch(source,/async function expectDenied/);});
test("app and worker restore login identity after commit and rollback",()=>{assert.match(source,/appAfterCommit/);assert.match(source,/appAfterRollback/);assert.match(source,/workerAfterCommit/);assert.match(source,/workerAfterRollback/);});
test("worker function denials exercise the exact M29 ACL boundary",()=>{for(const name of ["create_native_cart","add_native_cart_item","set_native_cart_item_quantity","remove_native_cart_item","merge_native_carts","submit_native_checkout"])assert.match(source,new RegExp(name));});
test("role activation SQLSTATE expectations preserve their distinct contracts",()=>{
  assert.match(source,/label:"APP_ASSUME_WORKER", expected:"42501"/);
  assert.match(source,/label:"APP_ASSUME_POSTGRES", expected:"42501"/);
  assert.match(source,/label:"APP_INVALID_ACTIVATION", expected:"22023"/);
  assert.match(source,/label:"WORKER_INVALID_ACTIVATION", expected:"22023"/);
  assert.doesNotMatch(source,/INVALID_ACTIVATION", expected:"42704"/);
});
