import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";

const base="supabase/.temp/pim-ai/p5d-200",load=async path=>JSON.parse(await readFile(`${base}/${path}`,"utf8"));

test("P5-D executa somente 131 elegíveis e preserva os 69 preflight quarantined",async()=>{
 const result=await load("results/execution-results.json");
 assert.equal(result.summary.manifestProducts,200);
 assert.equal(result.summary.preflightEligible,131);
 assert.equal(result.summary.preflightQuarantined,69);
 assert.equal(result.summary.attempts,131);
 assert.equal(result.summary.responses,131);
 assert.equal(result.summary.retries,0);
 assert.equal(result.summary.stale,0);
 assert.equal(result.summary.notExecuted,0);
 assert.equal(result.results.filter(item=>item.classification==="PASS").length,104);
 assert.equal(result.quarantine.filter(item=>item.classification==="QUALITY_LOCAL").length,21);
 assert.equal(result.quarantine.filter(item=>item.classification==="MODEL_LOCAL_CONTAINED").length,6);
});

test("P5-D respeita budget, evidence safety e zero persistência",async()=>{
 const result=await load("results/execution-results.json"),files=await readdir(`${base}/markers`),markers=files.filter(name=>/^product-\d{3}\.json$/.test(name));
 assert.ok(BigInt(result.summary.spentUsdMicros)<=1200000n);
 assert.equal(result.summary.batchStop,null);
 assert.equal(result.summary.openAiCalls,131);
 assert.equal(markers.length,131);
 assert.equal(result.summary.evidenceMetrics.unsafeAccepted,0);
 assert.equal(result.summary.evidenceMetrics.crossProductAttempts,0);
 assert.equal(result.summary.remoteMutations,0);
 assert.equal(result.summary.stagingWrites,0);
 assert.equal(result.summary.persistenceWrites,0);
 assert.deepEqual(result.summary.after,result.summary.before);
 assert.equal(result.summary.pimAiEnabledFinal,false);
});

test("P5-D grava checkpoints de recuperação sem retries",async()=>{
 const names=(await readdir(`${base}/execution`)).filter(name=>name.startsWith("checkpoint-")).sort();
 assert.deepEqual(names,["checkpoint-025.json","checkpoint-050.json","checkpoint-075.json","checkpoint-100.json","checkpoint-125.json","checkpoint-131.json"]);
 const final=await load("execution/checkpoint-131.json");
 assert.equal(final.attempted,131);
 assert.equal(final.remaining,0);
 assert.equal(final.systemicFailures,0);
});
