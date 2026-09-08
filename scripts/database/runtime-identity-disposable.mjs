import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { semanticProbePassed, waitForSemanticReadiness } from "./runtime-identity-readiness.mjs";
import { createExpectedErrorTracker, describePostgresErrorShape, expectPgErrorAtSavepoint, expectPgErrorInTransaction } from "./runtime-identity-expected-error.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("PERSI_OFFLINE_VALIDATION_REQUIRED");
const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const container = `persi-r4a-${crypto.randomBytes(6).toString("hex")}`;
const adminPassword = crypto.randomBytes(32).toString("base64url");
const appPassword = crypto.randomBytes(32).toString("base64url");
const workerPassword = crypto.randomBytes(32).toString("base64url");
const host = "127.0.0.1";

function run(command, args, { input, quiet = false, mergeOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(mergeOutput ? stdout+stderr : stdout) : reject(new Error(`${command} failed (${code}): ${quiet ? "output redacted" : stderr.trim()}`)));
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref(); server.on("error", reject);
    server.listen(0, host, () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

const port = await freePort();
let created = false;
let admin, app, worker;
const results = { image, imagePulled: false, host, port, isolatedStorage: "tmpfs", externalRequests: 0 };
const expectedErrors = createExpectedErrorTracker();
try {
  await run("docker", ["image", "inspect", image]);
  await run("docker", ["run", "-d", "--pull", "never", "--name", container,
    "-p", `${host}:${port}:5432`, "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=1g",
    "-e", `POSTGRES_PASSWORD=${adminPassword}`, image], { quiet: true });
  created = true;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"]); break; }
    catch { if (attempt === 59) throw new Error("DISPOSABLE_POSTGRES_NOT_READY"); await new Promise(r => setTimeout(r, 500)); }
  }
  const readiness = await waitForSemanticReadiness({
    requiredSuccesses: 3, pollMs: 500, timeoutMs: 90000,
    probe: async () => {
      const logs = await run("docker", ["logs", container], { mergeOutput:true });
      const initComplete = logs.includes("PostgreSQL init process complete; ready for start up.");
      let databaseReady = false;
      try {
        const probe = await run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-Atc",
          "select (current_setting('server_version_num')::int>=170000 and to_regnamespace('realtime') is not null and to_regnamespace('extensions') is not null and to_regrole('supabase_admin') is not null and to_regrole('authenticator') is not null)::text"]);
        databaseReady = probe.trim() === "true";
      } catch { databaseReady = false; }
      return semanticProbePassed({ initComplete, databaseReady });
    },
  });
  const migrationFiles = fs.readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
  assert.equal(migrationFiles.length, 29);
  const applied=[];
  for(const name of migrationFiles){
    if(name.startsWith("20260905180000_")) assert.equal(crypto.createHash("sha256").update(fs.readFileSync(`supabase/migrations/${name}`)).digest("hex"),"5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec");
    await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(`supabase/migrations/${name}`, "utf8") });
    applied.push(name);
  }
  admin = postgres({ host, port, database: "postgres", username: "postgres", password: adminPassword, max: 1, prepare: false });
  await admin.unsafe(`create role persi_app_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${appPassword}'`);
  await admin.unsafe(`create role persi_worker_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${workerPassword}'`);
  await admin.unsafe("grant connect on database postgres to persi_app_login, persi_worker_login");
  await admin.unsafe("grant persi_app to persi_app_login with admin false, inherit false, set true");
  await admin.unsafe("grant persi_worker to persi_worker_login with admin false, inherit false, set true");
  const memberships = await admin`select member.rolname member,granted.rolname granted,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles granted on granted.oid=m.roleid join pg_roles member on member.oid=m.member where member.rolname in ('persi_app_login','persi_worker_login') order by member.rolname`;
  assert.deepEqual(memberships.map(x => [x.member,x.granted,x.admin_option,x.inherit_option,x.set_option]), [["persi_app_login","persi_app",false,false,true],["persi_worker_login","persi_worker",false,false,true]]);
  app = postgres({ host, port, database: "postgres", username: "persi_app_login", password: appPassword, max: 1, prepare: false });
  worker = postgres({ host, port, database: "postgres", username: "persi_worker_login", password: workerPassword, max: 1, prepare: false });
  const [appBefore] = await app`select session_user,current_user,has_function_privilege(current_user,'public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','execute') can_submit`;
  assert.equal(appBefore.session_user,"persi_app_login"); assert.equal(appBefore.current_user,"persi_app_login"); assert.equal(appBefore.can_submit,false);
  const observedPermissionError = await expectPgErrorInTransaction(app, { label:"APP_ASSUME_WORKER", expected:"42501", tracker:expectedErrors, operation:tx => tx.unsafe("set local role persi_worker") });
  await expectPgErrorInTransaction(app, { label:"APP_ASSUME_POSTGRES", expected:"42501", tracker:expectedErrors, operation:tx => tx.unsafe("set local role postgres") });
  await expectPgErrorInTransaction(app, { label:"APP_INVALID_ACTIVATION", expected:"22023", tracker:expectedErrors, operation:tx => tx.unsafe("set local role persi_nonexistent") });
  await expectPgErrorInTransaction(app, { label:"APP_FALLBACK_DML", expected:"42501", tracker:expectedErrors, operation:tx => tx.unsafe("insert into public.carts default values") });
  await app.begin(async tx => {
    await tx.unsafe("set local role persi_app");
    const [identity] = await tx`select session_user,current_user,has_function_privilege(current_user,'public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','execute') can_submit`;
    assert.equal(identity.session_user,"persi_app_login"); assert.equal(identity.current_user,"persi_app"); assert.equal(identity.can_submit,true);
    await expectPgErrorAtSavepoint(tx, { label:"APP_CARTS_DML", expected:"42501", tracker:expectedErrors, operation:sql => sql`insert into public.carts default values` });
    await expectPgErrorAtSavepoint(tx, { label:"APP_CART_ITEMS_DML", expected:"42501", tracker:expectedErrors, operation:sql => sql`insert into public.cart_items default values` });
    const domainError = await expectPgErrorAtSavepoint(tx, { label:"APP_SUBMIT_DOMAIN", expected:"P0002", tracker:expectedErrors, operation:sql => sql`select * from public.submit_native_checkout('00000000-0000-4000-8000-000000000001',0,'0123456789abcdef',${"a".repeat(64)},null,${"b".repeat(64)},${"c".repeat(64)},${"d".repeat(64)},gen_random_uuid(),gen_random_uuid(),'Synthetic','synthetic@example.invalid',null,'{}'::jsonb,'{}'::jsonb,null,null,null,null)` });
    assert.equal(domainError.message,"CHECKOUT_NOT_FOUND");
    const [afterFunction] = await tx`select current_user`; assert.equal(afterFunction.current_user,"persi_app");
  });
  const [appAfterCommit] = await app`select current_user`; assert.equal(appAfterCommit.current_user,"persi_app_login");
  try { await app.begin(async tx => { await tx.unsafe("set local role persi_app"); throw new Error("ROLLBACK_PROBE"); }); } catch (error) { assert.equal(error.message,"ROLLBACK_PROBE"); }
  const [appAfterRollback] = await app`select current_user`; assert.equal(appAfterRollback.current_user,"persi_app_login");
  const [appPoolReuse] = await app`select session_user,current_user`; assert.equal(appPoolReuse.session_user,"persi_app_login"); assert.equal(appPoolReuse.current_user,"persi_app_login");
  const [workerBefore] = await worker`select session_user,current_user,has_function_privilege(current_user,'public.create_native_cart(uuid,uuid,text,char,timestamptz)','execute') can_create`;
  assert.equal(workerBefore.session_user,"persi_worker_login"); assert.equal(workerBefore.current_user,"persi_worker_login"); assert.equal(workerBefore.can_create,false);
  await expectPgErrorInTransaction(worker, { label:"WORKER_ASSUME_APP", expected:"42501", tracker:expectedErrors, operation:tx => tx.unsafe("set local role persi_app") });
  await expectPgErrorInTransaction(worker, { label:"WORKER_ASSUME_POSTGRES", expected:"42501", tracker:expectedErrors, operation:tx => tx.unsafe("set local role postgres") });
  await expectPgErrorInTransaction(worker, { label:"WORKER_INVALID_ACTIVATION", expected:"22023", tracker:expectedErrors, operation:tx => tx.unsafe("set local role persi_nonexistent") });
  await expectPgErrorInTransaction(worker, { label:"WORKER_FALLBACK_DML", expected:"42501", tracker:expectedErrors, operation:tx => tx.unsafe("insert into public.carts default values") });
  await worker.begin(async tx => {
    await tx.unsafe("set local role persi_worker");
    const [identity]=await tx`select session_user,current_user`;
    assert.equal(identity.session_user,"persi_worker_login"); assert.equal(identity.current_user,"persi_worker");
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_CARTS_DML", expected:"42501", tracker:expectedErrors, operation:sql => sql`insert into public.carts default values` });
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_CREATE_CART", expected:"42501", tracker:expectedErrors, operation:sql => sql.unsafe("select public.create_native_cart(gen_random_uuid(),null,'"+"e".repeat(64)+"','BRL',statement_timestamp()+interval '1 hour')") });
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_ADD_ITEM", expected:"42501", tracker:expectedErrors, operation:sql => sql.unsafe("select public.add_native_cart_item(gen_random_uuid(),null,'"+"e".repeat(64)+"',gen_random_uuid(),1)") });
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_SET_ITEM", expected:"42501", tracker:expectedErrors, operation:sql => sql.unsafe("select public.set_native_cart_item_quantity(gen_random_uuid(),null,'"+"e".repeat(64)+"',gen_random_uuid(),1)") });
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_REMOVE_ITEM", expected:"42501", tracker:expectedErrors, operation:sql => sql.unsafe("select public.remove_native_cart_item(gen_random_uuid(),null,'"+"e".repeat(64)+"',gen_random_uuid())") });
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_MERGE_CART", expected:"42501", tracker:expectedErrors, operation:sql => sql.unsafe("select public.merge_native_carts(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'"+"e".repeat(64)+"')") });
    await expectPgErrorAtSavepoint(tx, { label:"WORKER_SUBMIT", expected:"42501", tracker:expectedErrors, operation:sql => sql.unsafe("select public.submit_native_checkout(gen_random_uuid(),0,'0123456789abcdef','"+"a".repeat(64)+"',null,'"+"b".repeat(64)+"','"+"c".repeat(64)+"','"+"d".repeat(64)+"',gen_random_uuid(),gen_random_uuid(),'Synthetic','synthetic@example.invalid',null,'{}'::jsonb,'{}'::jsonb,null,null,null,null)") });
  });
  const [workerAfterCommit] = await worker`select current_user`; assert.equal(workerAfterCommit.current_user,"persi_worker_login");
  try { await worker.begin(async tx => { await tx.unsafe("set local role persi_worker"); throw new Error("ROLLBACK_PROBE"); }); } catch (error) { assert.equal(error.message,"ROLLBACK_PROBE"); }
  const [workerAfterRollback] = await worker`select current_user`; assert.equal(workerAfterRollback.current_user,"persi_worker_login");
  const [workerPoolReuse] = await worker`select session_user,current_user`; assert.equal(workerPoolReuse.session_user,"persi_worker_login"); assert.equal(workerPoolReuse.current_user,"persi_worker_login");
  const roleRows = await admin`select rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname in ('persi_app','persi_worker','persi_app_login','persi_worker_login') order by rolname`;
  assert.deepEqual(roleRows.map(row => [row.rolname,row.rolcanlogin,row.rolsuper,row.rolcreaterole,row.rolcreatedb,row.rolreplication,row.rolbypassrls]), [["persi_app",false,false,false,false,false,false],["persi_app_login",true,false,false,false,false,false],["persi_worker",false,false,false,false,false,false],["persi_worker_login",true,false,false,false,false,false]]);
  assert.equal(expectedErrors.missingSqlstates,0); assert.equal(expectedErrors.wrongSqlstates,0); assert.equal(expectedErrors.contaminations,0); assert.equal(expectedErrors.unexpectedSuccesses,0); assert.equal(expectedErrors.correct,expectedErrors.total);
  results.postgresql = (await admin`show server_version`)[0].server_version;
  results.migrationsApplied = migrationFiles.length;
  results.lastMigration = applied.at(-1);
  results.readiness = { attempts:readiness.attempts,consecutive:readiness.consecutive,regressions:readiness.regressions,durationMs:readiness.durationMs,pollMs:500,requiredSuccesses:3 };
  results.roles = roleRows;
  results.membershipOptions = "admin=false,inherit=false,set=true";
  results.authenticSessions = true; results.setLocalRole = true; results.roleLeakage = 0;
  results.directDmlDenied = true; results.securityDefinerChain = true;
  results.expectedErrors = expectedErrors;
  results.errorModel = { packageVersion:"3.4.9", trustedPath:"error.code", own:true, enumerable:true, ...describePostgresErrorShape(observedPermissionError) };
  results.poolReuse = { app:true, worker:true };
  results.failClosed = true;
  process.stdout.write(JSON.stringify(results, null, 2));
} finally {
  await Promise.allSettled([app?.end({ timeout: 2 }), worker?.end({ timeout: 2 }), admin?.end({ timeout: 2 })]);
  if (created) await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
}
