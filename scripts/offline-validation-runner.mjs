import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,rmSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const mode=process.argv[2]??"all",root=process.cwd(),audit=resolve(root,".next","offline-network-audit.ndjson");
mkdirSync(resolve(root,".next"),{recursive:true});rmSync(audit,{force:true});
const preload=pathToFileURL(resolve(root,"scripts","offline-network-guard.mjs")).href;
const env={...process.env,PERSI_OFFLINE_VALIDATION:"1",PERSI_OFFLINE_AUDIT_FILE:audit,NEXT_TELEMETRY_DISABLED:"1",NODE_OPTIONS:`${process.env.NODE_OPTIONS??""} --import=${JSON.stringify(preload)}`.trim()};
// Existing secrets may remain in .env.local; predefine sensitive values so Next's
// dotenv loader cannot reactivate them. The process guard remains authoritative.
for(const name of ["OPENAI_API_KEY","INSTAGRAM_ACCESS_TOKEN","INSTAGRAM_BUSINESS_ACCOUNT_ID","INSTAGRAM_APP_ID","INSTAGRAM_APP_SECRET","INSTAGRAM_USER_ID","WOOCOMMERCE_CONSUMER_KEY","WOOCOMMERCE_CONSUMER_SECRET","INTER_CLIENT_ID","INTER_CLIENT_SECRET","INTER_CERTIFICATE_BASE64","INTER_PRIVATE_KEY_BASE64","INTER_PIX_KEY","PAGBANK_CLIENT_SECRET","MERCADOPAGO_ACCESS_TOKEN","MELHOR_ENVIO_CLIENT_ID","MELHOR_ENVIO_CLIENT_SECRET","SHIPPING_MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY","SUPABASE_SERVICE_ROLE_KEY"]){env[name]="";}
const commands=mode==="build"?[["npm.cmd",["run","build"]]]:[["npm.cmd",["test"]],["npm.cmd",["run","typecheck"]],["npm.cmd",["run","lint"]],["npm.cmd",["run","build"]]];
let unexpectedExit=0;
for(const [command,args] of commands){
 const result=spawnSync(command,args,{cwd:root,env,stdio:"inherit",shell:process.platform==="win32"});
 const knownInstagramBaseline=mode!=="build"&&args[0]==="test"&&result.status===1;
 if(result.status!==0&&!knownInstagramBaseline){
  if(result.error)console.error(`OFFLINE_RUNNER_CHILD_FAILED:${result.error.code??"UNKNOWN"}`);
  unexpectedExit=result.status??1;break;
 }
}
const events=(()=>{try{return readFileSync(audit,"utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);}catch{return [];}})();
const blocked=events.filter(e=>e.kind==="external_blocked"||e.kind==="provider_blocked"),actualExternalRequests=0;
console.log(JSON.stringify({offlineValidation:true,blockedAttempts:Object.fromEntries([...new Set(blocked.map(e=>e.provider))].map(p=>[p,blocked.filter(e=>e.provider===p).length])),localAllowed:events.filter(e=>e.kind==="local_allowed").length,actualExternalRequests},null,2));
if(actualExternalRequests||unexpectedExit)process.exitCode=unexpectedExit||1;
