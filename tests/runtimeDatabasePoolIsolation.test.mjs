import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=readFileSync("scripts/database/runtime-identity-pool-stress.mjs","utf8");

test("R4-B remains local, offline, disposable and image-pull-free",()=>{assert.match(source,/PERSI_OFFLINE_VALIDATION/);assert.match(source,/--pull","never/);assert.match(source,/--tmpfs/);assert.match(source,/127\.0\.0\.1/);assert.doesNotMatch(source,/15422|supabase link|db push/);});
test("pool sizes 1, 2 and production-relevant 5 are explicit",()=>{assert.match(source,/poolSizes:\[1,2,5\]/);assert.match(source,/poolFor\(profile,1/);assert.match(source,/poolFor\(appProfile,2/);assert.match(source,/poolFor\(appProfile,5/);});
test("app and worker always use separate authentic credential pools",()=>{assert.match(source,/username:profile\.login,password:profile\.password/);assert.match(source,/appPassword/);assert.match(source,/workerPassword/);assert.match(source,/const app2=/);assert.match(source,/worker2=/);});
test("protected work uses SET LOCAL ROLE on the same transaction handle",()=>{assert.match(source,/pool\.begin\(async tx/);assert.match(source,/tx\.unsafe\(`set local role \$\{profile\.role\}`\)/);assert.match(source,/return callback\(tx\)/);assert.doesNotMatch(source,/reset role/i);});
test("stress minima and mixed parallel pools are encoded",()=>{assert.match(source,/index<200/);assert.match(source,/parallel\(200/);assert.match(source,/Promise\.all\(\[parallel\(200/);assert.match(source,/functionErrors>=25/);});
test("commit rollback database JS function and failed-activation paths are covered",()=>{for(const value of ["commit","rollback","database","function","failed-role","invalid-role"])assert.match(source,new RegExp(`\\"${value}\\"`));assert.match(source,/CONTROLLED_JS_ROLLBACK/);assert.match(source,/protectedCallbackAfterActivationFailure/);});
test("leakage and contamination metrics fail closed at zero",()=>{for(const value of ["appRoleLeakage","workerRoleLeakage","appToWorkerLeakage","workerToAppLeakage","postgresPrivilegeLeakage","contaminations","wrongSqlstates","unexpectedSuccesses"])assert.match(source,new RegExp(value));});
test("cleanup targets only the random R4-B container",()=>{assert.match(source,/persi-r4b-/);assert.match(source,/\["rm","-f",container\]/);});
