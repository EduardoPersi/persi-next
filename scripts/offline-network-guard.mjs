import {appendFileSync} from "node:fs";
import http from "node:http";
import https from "node:https";

const enabled=process.env.PERSI_OFFLINE_VALIDATION==="1";
const auditFile=process.env.PERSI_OFFLINE_AUDIT_FILE;
const localHosts=new Set(["127.0.0.1","localhost","::1","[::1]"]);
function targetUrl(input){
 try{return input instanceof URL?input:new URL(typeof input==="string"?input:input?.url);}catch{return null;}
}
function classify(host=""){
 const h=host.toLowerCase();
 if(h.includes("instagram"))return "instagram";
 if(h.includes("openai"))return "openai";
 if(h.includes("supabase"))return "remote_supabase";
 if(h.includes("olist"))return "olist";
 if(h.includes("mercadopago")||h.includes("pagbank")||h.includes("bancointer")||h.includes("inter.co"))return "payments";
 if(h.includes("melhorenvio")||h.includes("viacep"))return "shipping";
 if(h.includes("persimateriais")||h.includes("wordpress")||h.includes("woocommerce"))return "woocommerce";
 return "other";
}
function record(kind,url){
 if(!auditFile)return;
 appendFileSync(auditFile,JSON.stringify({kind,provider:classify(url?.hostname??""),host:url?.hostname??"unknown",pid:process.pid})+"\n");
}
function check(input){
 if(!enabled)return;
 const url=targetUrl(input);
 if(!url||!['http:','https:'].includes(url.protocol))return;
 if(localHosts.has(url.hostname)){record("local_allowed",url);return;}
 record("external_blocked",url);
 throw new Error(`EXTERNAL_NETWORK_BLOCKED:${classify(url.hostname)}`);
}

if(enabled){
 const originalFetch=globalThis.fetch;
 if(originalFetch)globalThis.fetch=function guardedFetch(input,init){check(input);return originalFetch.call(this,input,init);};
 for(const client of [http,https]){
  const request=client.request.bind(client),get=client.get.bind(client);
  client.request=function guardedRequest(...args){check(args[0]);return request(...args);};
  client.get=function guardedGet(...args){check(args[0]);return get(...args);};
 }
}

export {check as assertOfflineNetworkAllowed,classify};
