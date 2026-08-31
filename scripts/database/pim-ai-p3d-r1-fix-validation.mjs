import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {PimAttributeExtractor} from "../../lib/pim/extractor.ts";
import {reconcileEnrichmentOutput} from "../../lib/pim/conflict-reconciliation.ts";
import {validatePimStructuredOutput} from "../../lib/pim/structured-output.ts";
import {PROJECT_ROOT} from "./pim-ai-one-shot-guard.mjs";

const preserved=JSON.parse(await readFile(resolve(PROJECT_ROOT,"supabase/.temp/pim-ai/p3d-r1/p3d-r1-results.json"),"utf8"));
const original=preserved.results.find(item=>item.id==="P3D-R1-06")?.output;assert.ok(original);
const model=validatePimStructuredOutput(original),deterministic=new PimAttributeExtractor().extract({productId:"synthetic",title:"Luva Soldável 25mm",description:"Luva soldável de 25mm para instalação hidráulica.",brand:null,category:"Conexões Hidráulicas",sku:"synthetic",gtin:null,attributes:[{name:"bitola",value:"32mm"}]});
const result=reconcileEnrichmentOutput(deterministic,model),bitola=result.attributes.find(item=>item.attribute==="bitola");
assert.equal(model.attributes.find(item=>item.attribute==="bitola")?.status,"CANDIDATE");assert.equal(bitola?.status,"CONFLICT");assert.deepEqual(new Set(bitola?.candidates.map(item=>item.value)),new Set(["25mm","32mm"]));assert.equal(result.editorialBlockedByConflict,true);assert.equal(result.humanReviewRequired,true);assert.equal(result.acceptableForDraft,false);
console.log(JSON.stringify({realRequestAttempts:0,originalModelAttribute:"25mm / CANDIDATE",originalUncertainty:model.uncertainties[0],reconciledStatus:bitola.status,reconciledCandidates:bitola.candidates.map(item=>item.value),editorialSafe:result.editorialSafe,acceptableForDraft:result.acceptableForDraft,humanReviewRequired:result.humanReviewRequired,evidenceStructurallyValid:result.evidenceStructurallyValid,evidenceConsistencyValid:result.evidenceConsistencyValid,conflictFree:result.conflictFree},null,2));
