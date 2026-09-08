import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const base="supabase/.temp/pim-ai/p5c-r2",load=name=>readFile(`${base}/${name}`,"utf8").then(JSON.parse);
test("P5-C-R2 derivou onze restantes e respeitou budget",async()=>{const result=await load("final-results.json");assert.deepEqual(result.summary.authorizedProducts,[40,41,42,43,44,45,46,47,48,49,50]);assert.equal(result.summary.attempts,4);assert.equal(result.summary.responses,4);assert.equal(result.summary.retries,0);assert.ok(BigInt(result.summary.spentUsdMicros)<=100000n);});
test("P5-C-R2 acionou guard na segunda foreign evidence",async()=>{const result=await load("final-results.json");assert.equal(result.summary.batchStop,"SYSTEMIC_PATTERN:FOREIGN_EVIDENCE_REF:2_PRODUCTS");assert.equal(result.results.filter(item=>item.classification==="PASS").length,2);assert.equal(result.quarantine.length,2);assert.deepEqual(result.quarantine.map(item=>item.index),[41,43]);});
test("P5-C-R2 preservou staging e zero persistence",async()=>{const result=await load("final-results.json");assert.deepEqual(result.summary.before,result.summary.after);assert.equal(result.summary.remoteMutations,0);assert.equal(result.summary.stagingWrites,0);assert.equal(result.summary.persistenceWrites,0);assert.equal(result.summary.pimAiEnabledFinal,false);});
