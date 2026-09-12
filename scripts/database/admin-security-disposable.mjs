import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import {spawn} from "node:child_process";

if(process.env.PERSI_OFFLINE_VALIDATION!=="1")throw new Error("OFFLINE_VALIDATION_REQUIRED");
const image="public.ecr.aws/supabase/postgres:17.6.1.155",container=`persi-admin-a21-${crypto.randomBytes(5).toString("hex")}`;
function run(command,args,{input,quiet=false}={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:["pipe","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);child.on("error",reject);child.on("close",code=>code===0?resolve({stdout,stderr}):reject(new Error(`${command} failed (${code}): ${quiet?"redacted":stderr}`)));child.stdin.end(input)})}
const psql=["exec","-i",container,"psql","-U","postgres","-d","postgres","-X","-v","ON_ERROR_STOP=1","-At"];
async function sql(statement){return(await run("docker",psql,{input:`${statement}\n`})).stdout.trim()}
async function apply(filename){await run("docker",psql,{input:fs.readFileSync(`supabase/migrations/${filename}`,"utf8")});await sql(`insert into supabase_migrations.schema_migrations values('${filename.slice(0,14)}')`)}
let created=false;
try{
 await run("docker",["image","inspect",image]);await run("docker",["run","-d","--pull","never","--name",container,"--tmpfs","/var/lib/postgresql/data:rw,nosuid,size=1g","-e",`POSTGRES_PASSWORD=${crypto.randomBytes(24).toString("hex")}`,image],{quiet:true});created=true;
 let ready=0;for(let attempt=0;attempt<180;attempt++){try{const logs=await run("docker",["logs",container]),probe=await run("docker",["exec",container,"psql","-U","postgres","-d","postgres","-X","-Atc","select (current_setting('server_version')='17.6' and to_regrole('anon') is not null)::text"]);ready=logs.stdout.includes("PostgreSQL init process complete; ready for start up.")&&probe.stdout.trim()==="true"?ready+1:0;if(ready>=3)break}catch{ready=0}if(attempt===179)throw new Error("DISPOSABLE_POSTGRES_NOT_READY");await new Promise(r=>setTimeout(r,500))}
 await sql("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key)");
 await sql(fs.readFileSync("supabase/roles.sql","utf8"));
 await sql("alter default privileges for role postgres in schema public revoke select,insert,update,delete on tables from anon,authenticated");
 const migrations=fs.readdirSync("supabase/migrations").filter(x=>x.endsWith(".sql")).sort();assert.equal(migrations.length,33);assert.equal(new Set(migrations.map(x=>x.slice(0,14))).size,33);for(const migration of migrations)await apply(migration);
 const [result]=JSON.parse(await sql(`select json_agg(x) from(select (select count(*)::int from supabase_migrations.schema_migrations) migrations,(select count(*)::int from admin_memberships) memberships,(select relrowsecurity and relforcerowsecurity from pg_class where oid='public.admin_memberships'::regclass) rls,(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join(values('anon'),('authenticated'))r(role_name) cross join(values('SELECT'),('INSERT'),('UPDATE'),('DELETE'))p(privilege_name) where n.nspname='public' and c.relkind in('r','p') and has_table_privilege(r.role_name,c.oid,p.privilege_name)) browser_dml,(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join(values('anon'),('authenticated'))r(role_name) cross join(values('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN'))p(privilege_name) where n.nspname='public' and c.relkind in('r','p') and has_table_privilege(r.role_name,c.oid,p.privilege_name)) dangerous,(has_schema_privilege('anon','public','CREATE')::int+has_schema_privilege('authenticated','public','CREATE')::int)::int schema_create)x`));
 assert.deepEqual(result,{migrations:33,memberships:0,rls:true,browser_dml:0,dangerous:0,schema_create:0});
 await sql("create extension if not exists pgtap with schema extensions");for(const testFile of ["public_browser_privilege_remediation.test.sql","admin_security_foundation.test.sql"]){const output=await run("docker",psql,{input:`set search_path=public,extensions;\n${fs.readFileSync(`supabase/tests/database/${testFile}`,"utf8")}`});assert.doesNotMatch(output.stdout,/not ok/i)}
 console.log(JSON.stringify({postgres:"17.6",...result,pgTap:"PASS",stagingAccess:0,productionAccess:0},null,2));
}finally{if(created)await run("docker",["rm","-f",container],{quiet:true}).catch(()=>{})}
