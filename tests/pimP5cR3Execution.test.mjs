import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";

const base="supabase/.temp/pim-ai/p5c-r3";
const load=async name=>JSON.parse(await readFile(`${base}/${name}`,"utf8"));

test("P5-C-R3 executou exclusivamente os sete produtos restantes",async()=>{
 const result=await load("r3-results.json");
 assert.equal(result.phase,"P.5-C-R3-REAL-AI");
 assert.deepEqual(result.summary.authorizedProducts,[44,45,46,47,48,49,50]);
 assert.equal(result.summary.attempts,7);
 assert.equal(result.summary.responses,7);
 assert.equal(result.summary.retries,0);
 assert.equal(result.results.length,7);
 assert.ok(result.results.every(item=>item.classification==="PASS"));
 assert.deepEqual(result.quarantine,[]);
 assert.equal(result.summary.batchStop,null);
});

test("P5-C-R3 respeitou budget, one-shots e zero persistencia",async()=>{
 const result=await load("r3-results.json"),files=await readdir(base),markers=files.filter(name=>/^r3-product-\d{2}\.json$/.test(name));
 assert.ok(BigInt(result.summary.spentUsdMicros)<=60000n);
 assert.equal(result.summary.hardBudgetUsdMicros,"60000");
 assert.equal(markers.length,7);
 assert.equal(result.summary.openAiCalls,7);
 assert.equal(result.summary.stagingWrites,0);
 assert.equal(result.summary.persistenceWrites,0);
 assert.equal(result.summary.remoteMutations,0);
 assert.deepEqual(result.summary.after,result.summary.before);
 assert.equal(result.summary.pimAiEnabledFinal,false);
});
