import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const load=async()=>JSON.parse(await readFile("supabase/.temp/pim-ai/p5f-source-conflicts/results/replay-r4.json","utf8"));

test("P5-F recupera cobertura sem alterar o dataset historico",async()=>{
 const result=await load();
 assert.equal(result.dataset.products,172);assert.equal(result.dataset.conflictInstances,228);
 assert.equal(result.replay172.recoveredEligible,77);assert.equal(result.replay172.remainingQuarantine,95);
 assert.equal(result.replay500.eligibleBefore,327);assert.equal(result.replay500.eligibleAfter,400);
 assert.equal(result.replay500.sourceConflictsBefore,172);assert.equal(result.replay500.sourceConflictsAfter,95);
 assert.equal(result.historicalArtifacts.unchanged,true);
});

test("P5-F permanece offline read-only e fail-closed",async()=>{
 const result=await load();
 assert.equal(result.openAi.calls,0);assert.equal(result.openAi.costUsd,"0.00");
 assert.equal(result.database.writes,0);assert.deepEqual(result.database.after,result.database.before);
 assert.equal(result.persistence,0);assert.equal(result.pimAiEnabledFinal,false);
 assert.deepEqual(result.safety,{unsafeFactsAccepted:0,compoundCorruption:0,unitGuessing:0,silentPrecedence:0,aiGuessing:0});
 assert.ok(result.rootCauses.UNRESOLVED_AMBIGUITY>0);
 assert.equal(result.rootCauses.UNKNOWN,0);
});
