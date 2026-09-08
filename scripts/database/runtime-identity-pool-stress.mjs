import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { expectPgErrorAtSavepoint, expectPgErrorInTransaction, createExpectedErrorTracker } from "./runtime-identity-expected-error.mjs";
import { semanticProbePassed, waitForSemanticReadiness } from "./runtime-identity-readiness.mjs";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("PERSI_OFFLINE_VALIDATION_REQUIRED");

const IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.155";
const M29_HASH = "5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec";
const HOST = "127.0.0.1";
const container = `persi-r4b-${crypto.randomBytes(6).toString("hex")}`;
const adminPassword = crypto.randomBytes(32).toString("base64url");
const appPassword = crypto.randomBytes(32).toString("base64url");
const workerPassword = crypto.randomBytes(32).toString("base64url");

function run(command, args, { input, quiet = false, mergeOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio:["pipe","pipe","pipe"], windowsHide:true });
    let stdout="", stderr="";
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(mergeOutput ? stdout+stderr : stdout) : reject(new Error(`${command} failed (${code}): ${quiet ? "output redacted" : stderr.trim()}`)));
    child.stdin.end(input ?? undefined);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server=net.createServer(); server.unref(); server.on("error",reject);
    server.listen(0,HOST,()=>{const address=server.address();server.close(()=>resolve(address.port));});
  });
}

const expectedErrors=createExpectedErrorTracker();
const metrics={
  appTransactions:0,workerTransactions:0,appCommits:0,workerCommits:0,
  appRollbacks:0,workerRollbacks:0,appDatabaseErrors:0,workerDatabaseErrors:0,
  appJsExceptions:0,workerJsExceptions:0,functionErrors:0,appFailedActivations:0,
  workerFailedActivations:0,invalidRoles:0,appRoleLeakage:0,workerRoleLeakage:0,
  appToWorkerLeakage:0,workerToAppLeakage:0,postgresPrivilegeLeakage:0,
  protectedCallbackAfterActivationFailure:0,connectionChurnPass:false,
};
const backends={app:new Set(),worker:new Set()};

async function identity(sql, profile, expectedCurrent) {
  const [row]=await sql`select session_user,current_user,pg_backend_pid()::int pid`;
  backends[profile.kind].add(row.pid);
  if(row.current_user!==expectedCurrent){
    metrics[`${profile.kind}RoleLeakage`]++;
    if(row.current_user==="postgres")metrics.postgresPrivilegeLeakage++;
    if(profile.kind==="app"&&row.current_user==="persi_worker")metrics.appToWorkerLeakage++;
    if(profile.kind==="worker"&&row.current_user==="persi_app")metrics.workerToAppLeakage++;
  }
  assert.equal(row.session_user,profile.login);
  assert.equal(row.current_user,expectedCurrent);
  return row.pid;
}

async function withRole(pool, profile, callback) {
  return pool.begin(async tx=>{
    await identity(tx,profile,profile.login);
    await tx.unsafe(`set local role ${profile.role}`);
    await identity(tx,profile,profile.role);
    return callback(tx);
  });
}

async function assertClean(pool,profile){await identity(pool,profile,profile.login);}

const submitSql = "select public.submit_native_checkout('00000000-0000-4000-8000-000000000001',0,'0123456789abcdef','"+"a".repeat(64)+"',null,'"+"b".repeat(64)+"','"+"c".repeat(64)+"','"+"d".repeat(64)+"',gen_random_uuid(),gen_random_uuid(),'Synthetic','synthetic@example.invalid',null,'{}'::jsonb,'{}'::jsonb,null,null,null,null)";

async function cycle(pool,profile,mode,index=0){
  metrics[`${profile.kind}Transactions`]++;
  if(mode==="commit"){
    await withRole(pool,profile,tx=>tx`select 1`); metrics[`${profile.kind}Commits`]++;
  }else if(mode==="rollback"){
    await assert.rejects(withRole(pool,profile,async tx=>{await tx`select 1`;throw new Error("CONTROLLED_JS_ROLLBACK");}),/CONTROLLED_JS_ROLLBACK/);
    metrics[`${profile.kind}Rollbacks`]++; metrics[`${profile.kind}JsExceptions`]++;
  }else if(mode==="database"){
    await withRole(pool,profile,tx=>expectPgErrorAtSavepoint(tx,{label:`${profile.kind.toUpperCase()}_STRESS_DML`,expected:"42501",tracker:expectedErrors,operation:sql=>index%2===0?sql`insert into public.carts default values`:profile.kind==="worker"?sql.unsafe(submitSql):sql`insert into public.cart_items default values`}));
    metrics[`${profile.kind}DatabaseErrors`]++;
  }else if(mode==="function"){
    assert.equal(profile.kind,"app");
    const error=await withRole(pool,profile,tx=>expectPgErrorAtSavepoint(tx,{label:"APP_STRESS_FUNCTION",expected:"P0002",tracker:expectedErrors,operation:sql=>sql.unsafe(submitSql)}));
    assert.equal(error.message,"CHECKOUT_NOT_FOUND"); metrics.functionErrors++;
  }else if(mode==="failed-role"||mode==="invalid-role"){
    let callbackExecuted=false;
    const target=mode==="invalid-role"?"persi_nonexistent":profile.otherRole;
    const expected=mode==="invalid-role"?"22023":"42501";
    await expectPgErrorInTransaction(pool,{label:`${profile.kind.toUpperCase()}_${mode.replace("-","_").toUpperCase()}`,expected,tracker:expectedErrors,
      setup:tx=>identity(tx,profile,profile.login),operation:async tx=>{await tx.unsafe(`set local role ${target}`);callbackExecuted=true;}});
    if(callbackExecuted)metrics.protectedCallbackAfterActivationFailure++;
    assert.equal(callbackExecuted,false);
    if(mode==="invalid-role")metrics.invalidRoles++;else metrics[`${profile.kind}FailedActivations`]++;
  }else throw new Error("UNKNOWN_STRESS_MODE");
  await assertClean(pool,profile);
}

function poolFor(profile,max,port){return postgres({host:HOST,port,database:"postgres",username:profile.login,password:profile.password,max,prepare:false,idle_timeout:0});}
async function closePools(pools){await Promise.allSettled(pools.map(pool=>pool.end({timeout:3})));}
async function parallel(count,work,batch=25){for(let start=0;start<count;start+=batch)await Promise.all(Array.from({length:Math.min(batch,count-start)},(_,offset)=>work(start+offset)));}

const port=await freePort();
let created=false,admin; const pools=[]; const started=performance.now();
const results={image:IMAGE,imagePulled:false,host:HOST,port,storage:"tmpfs",externalRequests:0,postgresVersion:"3.4.9",prepare:false,poolSizes:[1,2,5]};
try{
  await run("docker",["image","inspect",IMAGE]);
  await run("docker",["run","-d","--pull","never","--name",container,"-p",`${HOST}:${port}:5432`,`--tmpfs`,`/var/lib/postgresql/data:rw,nosuid,size=1g`,`-e`,`POSTGRES_PASSWORD=${adminPassword}`,IMAGE],{quiet:true}); created=true;
  for(let attempt=0;attempt<60;attempt++){try{await run("docker",["exec",container,"pg_isready","-U","postgres","-d","postgres"]);break;}catch{if(attempt===59)throw new Error("DISPOSABLE_POSTGRES_NOT_READY");await new Promise(resolve=>setTimeout(resolve,500));}}
  const readiness=await waitForSemanticReadiness({requiredSuccesses:3,pollMs:500,timeoutMs:90000,probe:async()=>{
    const logs=await run("docker",["logs",container],{mergeOutput:true});
    let databaseReady=false;try{const probe=await run("docker",["exec",container,"psql","-U","postgres","-d","postgres","-X","-Atc","select (current_setting('server_version_num')::int>=170000 and to_regnamespace('realtime') is not null and to_regnamespace('extensions') is not null and to_regrole('supabase_admin') is not null and to_regrole('authenticator') is not null)::text"]);databaseReady=probe.trim()==="true";}catch{}
    return semanticProbePassed({initComplete:logs.includes("PostgreSQL init process complete; ready for start up."),databaseReady});
  }});
  const migrationFiles=fs.readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort();assert.equal(migrationFiles.length,29);
  for(const name of migrationFiles){if(name.startsWith("20260905180000_"))assert.equal(crypto.createHash("sha256").update(fs.readFileSync(`supabase/migrations/${name}`)).digest("hex"),M29_HASH);await run("docker",["exec","-i",container,"psql","-U","postgres","-d","postgres","-X","-v","ON_ERROR_STOP=1"],{input:fs.readFileSync(`supabase/migrations/${name}`,"utf8")});}
  admin=postgres({host:HOST,port,database:"postgres",username:"postgres",password:adminPassword,max:1,prepare:false});
  await admin.unsafe(`create role persi_app_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${appPassword}'`);
  await admin.unsafe(`create role persi_worker_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit password '${workerPassword}'`);
  await admin.unsafe("grant connect on database postgres to persi_app_login,persi_worker_login");
  await admin.unsafe("grant persi_app to persi_app_login with admin false,inherit false,set true");
  await admin.unsafe("grant persi_worker to persi_worker_login with admin false,inherit false,set true");
  const membership=await admin`select member.rolname member,granted.rolname granted,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles granted on granted.oid=m.roleid join pg_roles member on member.oid=m.member where member.rolname in ('persi_app_login','persi_worker_login') order by member.rolname`;
  assert.deepEqual(membership.map(row=>[row.member,row.granted,row.admin_option,row.inherit_option,row.set_option]),[["persi_app_login","persi_app",false,false,true],["persi_worker_login","persi_worker",false,false,true]]);
  const appProfile={kind:"app",login:"persi_app_login",role:"persi_app",otherRole:"persi_worker",password:appPassword};
  const workerProfile={kind:"worker",login:"persi_worker_login",role:"persi_worker",otherRole:"persi_app",password:workerPassword};

  for(const profile of [appProfile,workerProfile]){
    const pool=poolFor(profile,1,port);pools.push(pool);
    for(let index=0;index<200;index++){
      const remainder=index%4;
      const mode=remainder===0?"commit":remainder===1?"rollback":remainder===2?"database":index<100&&profile.kind==="app"?"function":"failed-role";
      await cycle(pool,profile,mode,index);
    }
    for(let index=0;index<5;index++)await cycle(pool,profile,"invalid-role",index);
    await pool.end({timeout:3});pools.splice(pools.indexOf(pool),1);
    const replacement=poolFor(profile,1,port);pools.push(replacement);await assertClean(replacement,profile);await replacement.end({timeout:3});pools.splice(pools.indexOf(replacement),1);
  }
  metrics.connectionChurnPass=true;

  const app2=poolFor(appProfile,2,port),worker2=poolFor(workerProfile,2,port);pools.push(app2,worker2);
  await parallel(200,index=>cycle(app2,appProfile,["commit","rollback","database","function"][index%4],index));
  await parallel(200,index=>cycle(worker2,workerProfile,["commit","rollback","database","failed-role"][index%4],index));
  await Promise.all([parallel(200,index=>cycle(app2,appProfile,"commit",index)),parallel(200,index=>cycle(worker2,workerProfile,"commit",index))]);
  await closePools([app2,worker2]);pools.splice(pools.indexOf(app2),1);pools.splice(pools.indexOf(worker2),1);

  const app5=poolFor(appProfile,5,port),worker5=poolFor(workerProfile,5,port);pools.push(app5,worker5);
  await Promise.all([parallel(100,index=>cycle(app5,appProfile,"commit",index),50),parallel(100,index=>cycle(worker5,workerProfile,"commit",index),50)]);
  await closePools([app5,worker5]);pools.splice(pools.indexOf(app5),1);pools.splice(pools.indexOf(worker5),1);

  assert.equal(expectedErrors.missingSqlstates,0);assert.equal(expectedErrors.wrongSqlstates,0);assert.equal(expectedErrors.contaminations,0);assert.equal(expectedErrors.unexpectedSuccesses,0);assert.equal(expectedErrors.correct,expectedErrors.total);
  for(const key of ["appRoleLeakage","workerRoleLeakage","appToWorkerLeakage","workerToAppLeakage","postgresPrivilegeLeakage","protectedCallbackAfterActivationFailure"])assert.equal(metrics[key],0);
  assert.ok(metrics.appCommits>=50&&metrics.workerCommits>=50&&metrics.appRollbacks>=50&&metrics.workerRollbacks>=50&&metrics.appDatabaseErrors>=50&&metrics.workerDatabaseErrors>=50&&metrics.appJsExceptions>=50&&metrics.workerJsExceptions>=50&&metrics.functionErrors>=25&&metrics.appFailedActivations>=25&&metrics.workerFailedActivations>=25);
  results.postgresql=(await admin`show server_version`)[0].server_version;results.migrations=29;results.readiness=readiness;results.metrics=metrics;results.expectedErrors=expectedErrors;
  results.backends={appUnique:backends.app.size,workerUnique:backends.worker.size,app:[...backends.app].sort((a,b)=>a-b),worker:[...backends.worker].sort((a,b)=>a-b),reuseObserved:backends.app.size<metrics.appTransactions&&backends.worker.size<metrics.workerTransactions};
  results.durationMs=Math.round(performance.now()-started);results.supavisorSpecificValidation="DEFERRED";
  process.stdout.write(JSON.stringify(results,null,2));
}finally{
  await closePools(pools);await admin?.end({timeout:3}).catch(()=>{});if(created)await run("docker",["rm","-f",container],{quiet:true}).catch(()=>{});
}
