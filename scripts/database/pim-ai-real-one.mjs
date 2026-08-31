import assert from "node:assert/strict";
import OpenAI from "openai";
import {zodTextFormat} from "openai/helpers/zod";
import {acquireOneShot,P3C_REAL_1C_MARKER_PATH,markAttemptedUnknown,markCompleted,markPreSendFailed} from "./pim-ai-one-shot-guard.mjs";

if(process.argv.slice(2).length!==1||process.argv[2]!=="--authorized-once")throw new Error("Explicit one-request authorization flag is required.");
process.loadEnvFile?.(".env.local");

const [{readPimAiConfig},{buildSafeAiProductContext},{buildPimAiPrompt},{estimatePimAiCost,assertPimAiBudget},{pimStructuredOutputSchema,validatePimStructuredOutput}]=await Promise.all([
 import("../../lib/pim/ai-config.ts"),import("../../lib/pim/safe-ai-context.ts"),import("../../lib/pim/ai-prompt.ts"),import("../../lib/pim/ai-governance.ts"),import("../../lib/pim/structured-output.ts")
]);
const config=readPimAiConfig();
assert.equal(config.enabled,false);assert.equal(config.provider,"openai");assert.equal(config.model,"gpt-5.4-mini");assert.ok(config.apiKey);assert.equal(config.maxOutputTokens,1200);assert.equal(config.includeGtin,false);
const product={productId:"synthetic-not-sent",name:'Luva de Redução Soldável com Rosca 25mm x 1/2" Tigre',description:'Conexão hidráulica para transição entre trecho soldável de 25mm e conexão roscável de 1/2".',sku:"synthetic-not-sent",gtin:null,brand:"Tigre",category:"Conexões Hidráulicas",attributes:[{name:"bitola",value:'25mm x 1/2"'},{name:"connection",value:"soldável + rosca"}]};
const safeContext=buildSafeAiProductContext(product,{includeGtin:false});
assert.equal("sku" in safeContext,false);assert.equal("gtin" in safeContext,false);assert.equal("productId" in safeContext,false);
const prompt=buildPimAiPrompt(safeContext),estimatedInputTokens=Math.ceil(JSON.stringify(prompt).length/4);
const estimate=estimatePimAiCost({estimatedInputTokens,maxOutputTokens:config.maxOutputTokens,inputUsdMicrosPerMillion:config.pricing?.inputUsdMicrosPerMillion??null,outputUsdMicrosPerMillion:config.pricing?.outputUsdMicrosPerMillion??null});
assertPimAiBudget(estimate,config.maxEstimatedCostUsdMicros);
const markerPath=P3C_REAL_1C_MARKER_PATH;
const guard=await acquireOneShot(markerPath,"P.3C-REAL-1C");
if(!guard.acquired)throw new Error(`P.3C-REAL-1 is blocked by one-shot state ${guard.state.state}.`);
let client;
try{client=new OpenAI({apiKey:config.apiKey,timeout:config.timeoutMs,maxRetries:0});}
catch(error){await markPreSendFailed(markerPath,error?.name??"client-construction-failed");throw error;}
const started=Date.now();
try{
 await markAttemptedUnknown(markerPath);
 const response=await client.responses.parse({model:config.model,instructions:prompt.systemInstructions,input:prompt.input,max_output_tokens:config.maxOutputTokens,text:{format:zodTextFormat(pimStructuredOutputSchema,prompt.schemaName)}});
 const output=validatePimStructuredOutput(response.output_parsed);
 const usage=response.usage;
 await markCompleted(markerPath,{requestStatus:response.status??"completed",responses:1});
 console.log(JSON.stringify({attempts:1,responses:1,status:response.status??"completed",durationMs:Date.now()-started,estimatedCostUsdMicros:estimate.status==="estimated"?estimate.usdMicros.toString():null,inputTokens:usage?.input_tokens??null,cachedInputTokens:usage?.input_tokens_details?.cached_tokens??0,outputTokens:usage?.output_tokens??null,totalTokens:usage?.total_tokens??null,output},null,2));
}catch(error){const httpStatus=typeof error?.status==="number"?error.status:null,errorCode=typeof error?.code==="string"?error.code:null,requestId=typeof error?.request_id==="string"?error.request_id:null,sanitizedMessage=typeof error?.message==="string"?error.message.replace(/(?:Bearer\s+|sk-)[A-Za-z0-9._-]+/gi,"[REDACTED]").slice(0,500):"OpenAI request failed";if(httpStatus!==null)await markCompleted(markerPath,{requestStatus:"failed",responses:0,httpStatus,errorCode,requestId});console.log(JSON.stringify({attempts:1,responses:0,status:httpStatus===null?"unknown":"failed",durationMs:Date.now()-started,errorType:error?.name??"Error",errorCode,requestId,httpStatus,sanitizedMessage},null,2));process.exitCode=1;}
