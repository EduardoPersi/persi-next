import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const load=async name=>JSON.parse(await readFile(`supabase/.temp/pim-ai/p5e-500/preflight/${name}`,"utf8"));

test("P5-E congela 500 novos produtos por hash e mede cobertura",async()=>{
 const manifest=await load("manifest.json");
 assert.equal(manifest.selection.selected,500);
 assert.equal(manifest.selection.unique,500);
 assert.equal(manifest.selection.previousProductsIncluded,0);
 assert.match(manifest.selection.method,/P5-E-500-V1/);
 assert.equal(new Set(manifest.products.map(item=>item.productLocalReference)).size,500);
 assert.ok(manifest.selection.coverage.categories>0);
 assert.ok(manifest.selection.coverage.brands>0);
 assert.equal(manifest.openAi.calls,0);
 assert.deepEqual(manifest.database.afterCounts,manifest.database.beforeCounts);
});

test("P5-E preserva source conflicts e autoriza somente elegíveis dentro do budget",async()=>{
 const manifest=await load("manifest.json"),plan=await load("execution-plan.json");
 assert.equal(manifest.preflight.eligible+manifest.preflight.quarantined,500);
 assert.equal(manifest.preflight.sourceConflictProducts,172);
 assert.equal(manifest.preflight.sourceConflictInstances,228);
 assert.ok(manifest.conflictDiagnostics.every(item=>item.canonicalAttribute&&item.conflictClass&&item.rootCause));
 assert.ok(Object.values(manifest.preflight.systemicGates).every(Boolean));
 assert.equal(plan.state,"PREFLIGHT_PASS_AUTHORIZED_TO_EXECUTE");
 assert.equal(plan.retries,0);
 assert.equal(plan.sequential,true);
 assert.equal(plan.persistenceAuthorized,false);
 assert.ok(plan.plannedMaxRequests<=500);
 assert.ok(BigInt(plan.cost.maximumEstimatedCostUsdMicros)<=2750000n);
});
