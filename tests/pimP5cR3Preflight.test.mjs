import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("P5-C-R3 limita autorizacao aos sete restantes e US$ 0,06",async()=>{
 const plan=JSON.parse(await readFile("supabase/.temp/pim-ai/p5c-r2-fix/final-7-plan.json","utf8"));
 const executor=await readFile("scripts/database/pim-ai-p5b-r1-execute.mjs","utf8");
 assert.equal(plan.state,"PREPARED_NOT_AUTHORIZED");
 assert.deepEqual(plan.indices,[44,45,46,47,48,49,50]);
 assert.equal(plan.retries,0);
 assert.equal(plan.sequential,true);
 assert.equal(plan.persistenceAuthorized,false);
 assert.equal(plan.fresh,true);
 assert.equal(plan.dlp,"PASS");
 assert.equal(plan.openAiCalls,0);
 assert.ok(Number(plan.cost.maximumSafeEstimateUsdMicros)<=60000);
 assert.match(executor,/--authorized-p5c-r3-7-calls-60k/);
 assert.match(executor,/p5cR3\?60000n/);
 assert.match(executor,/p5c-r3\/r3-results\.json/);
});
