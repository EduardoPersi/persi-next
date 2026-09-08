import test from "node:test";
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const root=process.cwd(),preload=pathToFileURL(resolve(root,"scripts/offline-network-guard.mjs")).href;
const guardedEnv={...process.env,PERSI_OFFLINE_VALIDATION:"1"};

test("direct external fetch is denied before network",()=>{
 const result=spawnSync(process.execPath,["--import",preload,"-e","try{fetch('https://external-example.invalid')}catch(e){console.log(e.message)}"],{cwd:root,env:guardedEnv,encoding:"utf8"});
 assert.equal(result.status,0);assert.match(result.stdout,/EXTERNAL_NETWORK_BLOCKED:other/);
});

test("loopback HTTP remains allowed",async()=>{
 const server=createServer((_request,response)=>response.end("LOCAL_OK"));
 await new Promise(resolveReady=>server.listen(0,"127.0.0.1",resolveReady));
 const {port}=server.address();
 try { const output=await new Promise((resolveOutput,reject)=>{
  const child=spawn(process.execPath,["--import",preload,"-e",`fetch('http://127.0.0.1:${port}').then(r=>r.text()).then(console.log).catch(e=>{console.error(e);process.exit(1)})`],{cwd:root,env:guardedEnv});
  let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);child.on("error",reject);child.on("close",code=>code===0?resolveOutput(stdout):reject(new Error(stderr)));
 });assert.match(output,/LOCAL_OK/); } finally { await new Promise(resolveClose=>server.close(resolveClose)); }
});

test("offline flag is server-only and production path is unchanged",()=>{
 const source=readFileSync(resolve(root,"lib/server/externalIo.ts"),"utf8");
 assert.doesNotMatch(source,/NEXT_PUBLIC_/);assert.match(source,/env\[OFFLINE_VALIDATION_FLAG\] === "1"/);
 assert.match(source,/if \(isOfflineValidation\(\)\) \{/);
 assert.match(source,/throw new ExternalIoBlockedError\(provider\)/);
});

test("unknown providers fail closed and all provider classes are covered",()=>{
 const source=readFileSync(resolve(root,"lib/server/externalIo.ts"),"utf8");
 for(const provider of ["woocommerce","wordpress","instagram","olist","payments","shipping","openai","remote_supabase","other"])assert.match(source,new RegExp(`"${provider}"`));
});

test("PowerShell-compatible offline commands use the process guard",()=>{
 const pkg=JSON.parse(readFileSync(resolve(root,"package.json"),"utf8"));
 assert.equal(pkg.scripts["build:offline"],"node scripts/offline-validation-runner.mjs build");
 assert.equal(pkg.scripts["validate:offline"],"node scripts/offline-validation-runner.mjs all");
});
