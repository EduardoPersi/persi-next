import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const base="supabase/.temp/pim-ai/p5c-50";
const load=name=>readFile(`${base}/${name}`,"utf8").then(JSON.parse);

test("P5-C respeitou one-shots, zero retry e hard budget",async()=>{
  const result=await load("scale-results.json");
  assert.equal(result.phase,"P.5-C-50-REAL-AI");
  assert.equal(result.summary.attempts,6);
  assert.equal(result.summary.responses,6);
  assert.equal(result.summary.openAiCalls,6);
  assert.equal(result.summary.retries,0);
  assert.ok(BigInt(result.summary.spentUsdMicros)<=400000n);
  assert.equal(result.summary.hardBudgetUsdMicros,"400000");
});

test("P5-C acionou o stop sistemico na segunda divergencia semantica",async()=>{
  const result=await load("scale-results.json");
  assert.equal(result.summary.batchStop,"SYSTEMIC_PATTERN:SEMANTIC_EVIDENCE_MISMATCH:2_PRODUCTS");
  assert.deepEqual(result.results.map(item=>item.index),[1,2,5]);
  assert.ok(result.results.every(item=>item.classification==="PASS"&&item.persistencePerformed===false));
  assert.deepEqual(result.quarantine.map(item=>item.index),[3,4,6]);
  assert.equal(result.quarantine.filter(item=>item.reason.startsWith("SEMANTIC_EVIDENCE_MISMATCH:")).length,2);
});

test("P5-C preservou staging e nao persistiu outputs",async()=>{
  const result=await load("scale-results.json");
  assert.deepEqual(result.summary.before,result.summary.after);
  assert.equal(result.summary.remoteMutations,0);
  assert.equal(result.summary.stagingWrites,0);
  assert.equal(result.summary.persistenceWrites,0);
  assert.equal(result.summary.pimAiEnabledFinal,false);
});

test("P5-C possui marcadores completos somente para as chamadas realizadas",async()=>{
  const batch=await load("scale-batch-marker.json");
  assert.equal(batch.state,"COMPLETED");
  assert.equal(batch.attempts,6);
  assert.equal(batch.retries,0);
  for(let index=1;index<=6;index+=1){
    const marker=await load(`scale-product-${String(index).padStart(2,"0")}.json`);
    assert.equal(marker.state,"COMPLETED");
    assert.equal(marker.responses,1);
  }
});
