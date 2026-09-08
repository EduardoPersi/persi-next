import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("relatório preserva histórico e mantém readiness 50 sem executar",async()=>{const report=JSON.parse(await readFile("supabase/.temp/pim-ai/p5b-r1-p9-analysis/analysis-report.json","utf8"));assert.equal(report.historicalArtifactsPreserved,true);assert.equal(report.revalidated.length,10);assert.ok(report.revalidated.every(item=>item.evidenceValidation==="PASS"));assert.equal(report.eligibleHistorical,9);assert.equal(report.quarantinedHistorical,1);assert.equal(report.scaleReadiness50,"PASS");assert.equal(report.openAiCalls,0);assert.equal(report.stagingWrites,0);});
