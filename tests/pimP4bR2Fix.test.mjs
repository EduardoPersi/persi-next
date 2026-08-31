import assert from "node:assert/strict";
import test from "node:test";
import {PIM_OUTPUT_POLICY_VERSION,PIM_SCHEMA_VERSION,PIM_TARGET_OUTPUT_TOKENS,diagnoseOpenAiStructuredResponse} from "../lib/pim/ai-output-policy.ts";
import {PIM_PROMPT_VERSION} from "../lib/pim/enrichment-types.ts";
import {createPimAiRequestFingerprint} from "../lib/pim/pilot-preparation.ts";
import {PIM_LEGACY_OUTPUT_LIMITS as PIM_OUTPUT_LIMITS,validatePimStructuredOutput} from "../lib/pim/structured-output.ts";

const evidence={sourceType:"SOURCE_DESCRIPTION",sourceReference:"description",rawValue:"Fato técnico explícito.",normalizedValue:"Fato técnico",confidence:.95,extractionMethod:"structured_source"};
const base={suggestedName:"Produto técnico",shortDescription:"Descrição curta e factual.",longDescription:"Descrição comercial objetiva baseada apenas nos dados fornecidos.",bulletPoints:["Primeiro fato evidenciado","Segundo fato evidenciado","Terceiro fato evidenciado"],application:"Aplicação explicitamente informada.",attributes:[{attribute:"brand",value:"Marca",confidence:.99,status:"CANDIDATE",evidence:[{...evidence,sourceType:"SOURCE_BRAND",sourceReference:"brand",rawValue:"Marca",normalizedValue:"Marca"}],needsEvidence:false}],seo:{title:"Produto técnico | Marca",metaDescription:"Descrição factual e concisa do produto técnico.",searchTerms:["produto técnico","marca"]},uncertainties:[],evidenceReferences:["title","description","brand"]};

test("diagnóstico distingue parsed null, incomplete, refusal e Zod local",()=>{
 assert.equal(diagnoseOpenAiStructuredResponse({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},usage:{output_tokens:1200}},null,1200).classification,"OUTPUT_PARSED_NULL_INCOMPLETE_RESPONSE");
 assert.equal(diagnoseOpenAiStructuredResponse({status:"completed",usage:{output_tokens:1200}},null,1200).classification,"OUTPUT_PARSED_NULL_WITH_OUTPUT_LIMIT");
 assert.equal(diagnoseOpenAiStructuredResponse({status:"completed",output:[{content:[{type:"refusal",refusal:"Não posso ajudar"}]}]},null,1200).classification,"OUTPUT_PARSED_NULL_REFUSAL");
 const parsed=diagnoseOpenAiStructuredResponse({status:"completed",usage:{output_tokens:100}},base,1200);assert.equal(parsed.providerParsedOutputAvailable,true);assert.equal(parsed.localZodExecuted,false);assert.equal(parsed.classification,"PARSED_OUTPUT_AVAILABLE");
});

test("contrato editorial aplica todos os limites sem quebrar valor composto",()=>{
 const compound={...base,attributes:[{...base.attributes[0],attribute:"bitola",value:'25mm x 3/4"',evidence:[{...evidence,rawValue:'25mm x 3/4"',normalizedValue:'25mm x 3/4"'}]}]};assert.equal(validatePimStructuredOutput(compound).attributes[0].value,'25mm x 3/4"');
 const checks=[["suggestedName",{...base,suggestedName:"x".repeat(PIM_OUTPUT_LIMITS.displayName+1)}],["shortDescription",{...base,shortDescription:"x".repeat(PIM_OUTPUT_LIMITS.shortDescription+1)}],["longDescription",{...base,longDescription:"x".repeat(PIM_OUTPUT_LIMITS.longDescription+1)}],["bulletPoints",{...base,bulletPoints:Array(PIM_OUTPUT_LIMITS.bulletCount+1).fill("fato")}],["bulletLength",{...base,bulletPoints:["x".repeat(PIM_OUTPUT_LIMITS.bulletLength+1)]}],["application",{...base,application:"x".repeat(PIM_OUTPUT_LIMITS.application+1)}],["seoTitle",{...base,seo:{...base.seo,title:"x".repeat(PIM_OUTPUT_LIMITS.seoTitle+1)}}],["metaDescription",{...base,seo:{...base.seo,metaDescription:"x".repeat(PIM_OUTPUT_LIMITS.metaDescription+1)}}],["searchTerms",{...base,seo:{...base.seo,searchTerms:Array(PIM_OUTPUT_LIMITS.searchTerms+1).fill("termo")}}],["uncertainties",{...base,uncertainties:Array(PIM_OUTPUT_LIMITS.uncertainties+1).fill("incerteza")}]];
 for(const [name,value] of checks)assert.throws(()=>validatePimStructuredOutput(value),{name:"ZodError"},name);
});

test("fixture rica permanece concisa e validável abaixo da meta operacional",()=>{
 const rich={...base,longDescription:"Placa para instalação elétrica com dados técnicos evidenciados, apresentada de forma objetiva sem repetir integralmente a fonte.",bulletPoints:["Dois postos afastados","Formato 4x2 preservado sem unidade inferida","Cor branca","Linha explicitamente identificada","Marca evidenciada"],attributes:["brand","color","line","connection","application"].map((attribute,index)=>({attribute,value:["Marca","Branco","Linha","2 postos","Instalação elétrica"][index],confidence:.95,status:"CANDIDATE",evidence:[evidence],needsEvidence:false})),seo:{...base.seo,searchTerms:["placa 4x2","dois postos","placa branca","linha","marca"]},uncertainties:["A representação 4x2 foi mantida sem inferir unidade."]};
 validatePimStructuredOutput(rich);assert.ok(Math.ceil(JSON.stringify(rich).length/4)<=PIM_TARGET_OUTPUT_TOKENS);
});

test("request fingerprint é estável e muda com prompt, schema ou policy",()=>{
 const input={safeContextFingerprint:"safe",model:"gpt-5.4-mini",promptVersion:PIM_PROMPT_VERSION,schemaVersion:PIM_SCHEMA_VERSION,outputPolicyVersion:PIM_OUTPUT_POLICY_VERSION},fingerprint=createPimAiRequestFingerprint(input);assert.equal(fingerprint,createPimAiRequestFingerprint({...input}));
 for(const key of ["promptVersion","schemaVersion","outputPolicyVersion"])assert.notEqual(fingerprint,createPimAiRequestFingerprint({...input,[key]:`${input[key]}-changed`}));
});
