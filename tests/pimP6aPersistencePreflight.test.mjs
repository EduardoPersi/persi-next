import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const base="supabase/.temp/pim-ai/p6a-persistence-preflight";
const load=async name=>JSON.parse(await readFile(`${base}/${name}`,"utf8"));

test("P6-A inventaria respostas reais sem fabricar resultados",async()=>{
 const report=await load("preflight-report.json");
 assert.equal(report.realAiInventory.totalRealResponses,519);
 assert.equal(report.realAiInventory.completeArtifacts,480);
 assert.equal(report.realAiInventory.historicalPass,402);
 assert.equal(report.realAiInventory.historicalQuarantine,78);
 assert.equal(report.realAiInventory.incomplete,39);
 assert.equal(report.currentRevalidation.currentPass,387);
 assert.equal(report.currentRevalidation.currentQuarantine,15);
});

test("P6-A produz somente suggestions novas needs_review e campos suportados",async()=>{
 const manifest=await load("persistence-manifest.json"),supported=new Set(["commercial_name","short_description","description","application","seo_title","meta_description"]);
 assert.equal(manifest.manifestCount,2322);
 assert.equal(new Set(manifest.items.map(item=>item.productId)).size,387);
 assert.ok(manifest.items.every(item=>item.status==="needs_review"&&item.source==="ai"&&supported.has(item.field)));
 assert.ok(manifest.items.every(item=>/^[a-f0-9]{64}$/.test(item.idempotencyKey)&&/^[a-f0-9]{64}$/.test(item.resultFingerprint)));
 assert.equal(new Set(manifest.items.map(item=>item.idempotencyKey)).size,manifest.items.length);
});

test("P6-A preserva freshness, RLS, rollback e zero persistence",async()=>{
 const report=await load("preflight-report.json");
 assert.deepEqual(report.database.after,report.database.before);
 assert.equal(report.database.committedWrites,0);
 assert.equal(report.freshness.freshExact,402);assert.equal(report.freshness.stale,0);assert.equal(report.freshness.missing,0);
 assert.equal(report.rlsAuth.rlsEnabled,true);assert.equal(report.rlsAuth.publicPolicies,0);assert.equal(report.rlsAuth.anonymousWrite,"BLOCKED");
 assert.ok(["insert","constraints","fk","status","idempotency","concurrency","rollback"].every(key=>report.simulation[key]==="PASS"));
 assert.equal(report.openAi.calls,0);assert.equal(report.pimAiEnabledFinal,false);
});

test("P6-A registra hash canônico e políticas imutáveis",async()=>{
 const manifest=await load("persistence-manifest.json"),{manifestHash,manifestCount,...core}=manifest;
 assert.equal(manifestCount,manifest.items.length);
 assert.equal(createHash("sha256").update(JSON.stringify(core)).digest("hex"),manifestHash);
 assert.equal(manifest.writePolicy.autoApprove,false);assert.equal(manifest.writePolicy.publish,false);assert.equal(manifest.writePolicy.exactHashRequired,true);
});
