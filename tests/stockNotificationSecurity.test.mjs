import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { signStockRequest } from "../lib/stock-notifications/hmac.ts";
import { parseBrowserStockSubscription, parseStockToken } from "../lib/stock-notifications/validation.ts";

const config={secret:"test-only-secret",keyId:"Primary",origin:"https://frontend.test"};
test("HMAC de estoque assina corpo bruto e canonical sem newline final",()=>{
 const rawBody='{"productId":1}';const result=signStockRequest({path:"/wp-json/persi/v1/stock-notifications/subscribe",rawBody},config,{timestamp:"1800000000",nonce:"abcdefghijklmnopqrstuv"});
 const canonical=["POST","/wp-json/persi/v1/stock-notifications/subscribe","1800000000","abcdefghijklmnopqrstuv","https://frontend.test",createHash("sha256").update(rawBody).digest("hex")].join("\n");
 assert.equal(result.canonical,canonical);assert.equal(result.canonical.endsWith("\n"),false);assert.equal(result.headers["X-Persi-Signature"],`v1=${createHmac("sha256",config.secret).update(canonical).digest("hex")}`);
});
test("payload do navegador é fechado e consentimento obrigatório",()=>{
 const valid={productId:1,email:"CLIENTE@example.test",website:"",consent:true};
 assert.deepEqual(parseBrowserStockSubscription(valid),{productId:1,variationId:0,email:"cliente@example.test",website:"",consent:true});
 assert.throws(()=>parseBrowserStockSubscription({...valid,consent:false}));
 assert.throws(()=>parseBrowserStockSubscription({...valid,privacyPolicyVersion:"forjada"}));
 assert.throws(()=>parseBrowserStockSubscription({...valid,website:"bot"}));
});
test("token headless possui contrato fechado",()=>{assert.equal(parseStockToken({token:"A".repeat(48)}),"A".repeat(48));assert.throws(()=>parseStockToken({token:"curto"}));assert.throws(()=>parseStockToken({token:"A".repeat(48),email:"x"}));});
test("rotas de token aplicam no-store e no-referrer",async()=>{for(const file of ["../app/api/stock-notifications/confirm/route.ts","../app/api/stock-notifications/unsubscribe/route.ts"]){const source=await readFile(new URL(file,import.meta.url),"utf8");assert.match(source,/no-store/);assert.match(source,/no-referrer/);assert.equal(source.includes("console."),false);}});
