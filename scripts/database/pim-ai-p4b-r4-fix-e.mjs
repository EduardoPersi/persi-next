import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {auditSourceOnlyText,classifyProtectedTechnicalStatements} from "../../lib/pim/semantic-validation.ts";

const resultsPath="supabase/.temp/pim-ai/p4b-r4/p4b-r4-results.json";
const markerPath="supabase/.temp/pim-ai/p4b-r4/p4b-r4-e.json";
const manifestPath="supabase/.temp/pim-ai/p4b-r4/preflight-manifest.json";
const auditPath="supabase/.temp/pim-ai/p4b-r4/p4b-r4-e-offline-revalidation.json";
const hash=value=>createHash("sha256").update(value).digest("hex");
const allText=output=>[output.suggestedName,output.shortDescription,output.longDescription,...output.bulletPoints,output.application,...output.attributes.flatMap(item=>[item.attribute,item.value]),output.seo.title,output.seo.metaDescription,...output.seo.searchTerms,...output.uncertainties].filter(Boolean).join("\n");

const [resultsRaw,markerRaw,manifestRaw,historicRaw]=await Promise.all([readFile(resultsPath,"utf8"),readFile(markerPath,"utf8"),readFile(manifestPath,"utf8"),readFile("supabase/.temp/pim-ai/p4b-r2-fix/offline-audit.json","utf8")]);
const results=JSON.parse(resultsRaw),marker=JSON.parse(markerRaw),manifest=JSON.parse(manifestRaw),historic=JSON.parse(historicRaw);
const e=results.results.find(item=>item.pilotId==="P4B-R4-E"),d=results.results.find(item=>item.pilotId==="P4B-R4-D"),prepared=manifest.products.find(item=>item.pilotId==="P4B-R4-E");
assert.ok(e&&d&&prepared);assert.equal(marker.test,"P4B-R4-E");assert.equal(marker.state,"COMPLETED");
const output=e.compactModelOutput,outputText=allText(output),protectedTerms=["material","pressure","pressão","temperature","temperatura","certification","certificação","standard","norma","voltage","tensão","current","corrente","power","potência","dimensions","dimensões","warranty","garantia","ABNT","NBR","compatibilidade"];
const classifications=classifyProtectedTechnicalStatements(outputText,protectedTerms),sourceStrings=[e.product,...prepared.evidenceCatalog.flatMap(item=>[item.attribute,item.value])],unsupportedTextAfterFix=auditSourceOnlyText(outputText,sourceStrings,protectedTerms);
const evidenceIds=new Set(prepared.evidenceCatalog.map(item=>item.id)),evidenceResolution=output.attributes.every(item=>item.evidenceRefs.length>0&&item.evidenceRefs.every(ref=>evidenceIds.has(ref)));
const materialStatements=classifications.filter(item=>item.term==="material"),exactRegression=materialStatements.some(item=>item.classification==="INSUFFICIENT_EVIDENCE"&&/não há evidência para confirmar material/iu.test(item.textSpan));
const reconciliation=e.finalReconciledOutput,semanticValidation=e.semanticMismatches.length===0,structuredOutput=e.providerParsedOutput===true,zod=e.zod===true,blockingConflicts=reconciliation.blockingConflicts.length,unsupportedTechnicalFacts=reconciliation.unsupportedFacts.length,hallucinations=unsupportedTextAfterFix.length;
const finalPipelineSafety=structuredOutput&&zod&&evidenceResolution&&semanticValidation&&blockingConflicts===0&&unsupportedTechnicalFacts===0&&unsupportedTextAfterFix.length===0;
const regressions={A:historic.regressions?.find(item=>item.pilotId.endsWith("A"))?.pass===true,B:historic.regressions?.find(item=>item.pilotId.endsWith("B"))?.pass===true,C:historic.regressions?.find(item=>item.pilotId.endsWith("C"))?.pass===true,D:d.pass===true&&d.finalReconciledOutput.blockingConflicts.length===0&&d.finalReconciledOutput.unsupportedFacts.length===0};
const audit={phase:"P.4-B-R4-FIX-E",mode:"OFFLINE_ONLY",auditorVersion:"protected-technical-statements-v2",realRequestAttempts:0,realAiCalls:0,realAiCostUsdMicros:"0",markerPreserved:true,rawResultsHash:hash(resultsRaw),markerHash:hash(markerRaw),parsedOutputHash:hash(JSON.stringify(output)),rootCause:{confirmed:exactRegression,protectedTerm:"material",originalClassification:"ASSERTED_FACT",newClassification:"INSUFFICIENT_EVIDENCE",falsePositiveRemoved:unsupportedTextAfterFix.length===0},classifications,evaluation:{structuredOutput,zod,evidenceResolution,semanticValidation,blockingConflicts,unsupportedTechnicalFacts,protectedTermFalsePositives:unsupportedTextAfterFix,hallucinations,finalPipelineSafety:finalPipelineSafety?"PASS":"FAIL",acceptableForControlledDraft:finalPipelineSafety&&reconciliation.acceptableForDraft},regressions,realCommercialProductsApproved:Object.values(regressions).filter(Boolean).length+(finalPipelineSafety?1:0),realCommercialProductPilot:Object.values(regressions).every(Boolean)&&finalPipelineSafety?"5/5 PASS":"FAIL",remote:{stagingWrites:0,productionAccess:0,woocommerceWrites:0,olistWrites:0,pimSuggestions:0,drafts:0,approvals:0,publication:0}};
await writeFile(auditPath,`${JSON.stringify(audit,null,2)}\n`,"utf8");
assert.equal(hash(await readFile(resultsPath,"utf8")),audit.rawResultsHash);assert.equal(hash(await readFile(markerPath,"utf8")),audit.markerHash);
console.log(JSON.stringify({phase:audit.phase,realAiCalls:0,rootCause:audit.rootCause,evaluation:audit.evaluation,regressions,realCommercialProductPilot:audit.realCommercialProductPilot,remote:audit.remote},null,2));
