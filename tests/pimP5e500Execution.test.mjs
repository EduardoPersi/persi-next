import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const resultPath="supabase/.temp/pim-ai/p5e-500/results/execution-results.json";
const load=async()=>JSON.parse(await readFile(resultPath,"utf8"));

test("P5-E conclui somente os 327 elegiveis dentro do hard budget",async()=>{
 const execution=await load(),summary=execution.summary;
 assert.equal(summary.attempts,327);
 assert.equal(summary.responses,327);
 assert.equal(summary.retries,0);
 assert.equal(summary.openAiCalls,327);
 assert.equal(summary.batchStop,null);
 assert.ok(BigInt(summary.spentUsdMicros)<=BigInt(summary.hardBudgetUsdMicros));
 assert.equal(summary.stale,0);
 assert.equal(summary.notExecuted,0);
});

test("P5-E mantem staging e PIM sem mutacoes",async()=>{
 const {summary}=await load();
 assert.deepEqual(summary.after,summary.before);
 assert.equal(summary.remoteMutations,0);
 assert.equal(summary.stagingWrites,0);
 assert.equal(summary.persistenceWrites,0);
 assert.equal(summary.pimAiEnabledFinal,false);
});

test("P5-E contem referencias estrangeiras e preserva os gates",async()=>{
 const execution=await load(),{summary,evidenceMetrics}=execution;
 assert.equal(evidenceMetrics.foreignRefs,24);
 assert.equal(evidenceMetrics.containedNoRebound,24);
 assert.equal(evidenceMetrics.crossProductAttempts,0);
 assert.equal(evidenceMetrics.unsafeAccepted,0);
 assert.equal(execution.results.filter(item=>item.classification==="PASS").length,253);
 assert.equal(execution.results.filter(item=>item.classification==="QUALITY_LOCAL").length,50);
 assert.equal(summary.preflightQuarantined,173);
 assert.equal(execution.quarantine.length,247);
});
