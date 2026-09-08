import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const load=async name=>JSON.parse(await readFile(`supabase/.temp/pim-ai/p5d-200/preflight/${name}`,"utf8"));

test("P5-D congela 200 produtos determinísticos sem reutilizar pilotos",async()=>{
 const manifest=await load("manifest.json");
 assert.equal(manifest.selection.selected,200);
 assert.equal(manifest.selection.unique,200);
 assert.equal(manifest.selection.previousProductsIncluded,0);
 assert.match(manifest.selection.method,/SHA256/);
 assert.equal(new Set(manifest.products.map(item=>item.productLocalReference)).size,200);
 assert.equal(manifest.openAi.calls,0);
 assert.equal(manifest.database.writes,0);
 assert.deepEqual(manifest.database.afterCounts,manifest.database.beforeCounts);
});

test("P5-D autoriza condicionalmente somente os elegíveis dentro de US$ 1,20",async()=>{
 const manifest=await load("manifest.json"),plan=await load("execution-plan.json");
 assert.equal(manifest.preflight.eligible+manifest.preflight.quarantined,200);
 assert.equal(manifest.preflight.blocked,0);
 assert.ok(Object.values(manifest.preflight.systemicGates).every(Boolean));
 assert.equal(plan.state,"PREFLIGHT_PASS_AUTHORIZED_TO_EXECUTE");
 assert.equal(plan.retries,0);
 assert.equal(plan.sequential,true);
 assert.equal(plan.persistenceAuthorized,false);
 assert.ok(plan.plannedMaxRequests<=200);
 assert.ok(BigInt(plan.cost.maximumEstimatedCostUsdMicros)<=1200000n);
 assert.equal(plan.budgetPreflightBlock,false);
});
