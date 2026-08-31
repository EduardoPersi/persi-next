import "server-only";
import OpenAI from "openai";
import {zodTextFormat} from "openai/helpers/zod";
import {ZodError} from "zod";
import {readPimAiConfig,type PimAiConfig} from "./ai-config";
import {PimAiError,normalizePimAiError} from "./ai-errors";
import {assertPimAiBudget,estimatePimAiCost,PimAiInFlightGuard,PimAiRateLimiter} from "./ai-governance";
import {buildPimAiPrompt} from "./ai-prompt";
import type {PimEnrichmentProvider,PimEnrichmentSuggestion,PimProviderResult,PimSuggestionInput} from "./enrichment-provider";
import {createPimSourceFingerprint} from "./fingerprint";
import {buildSafeAiProductContext} from "./safe-ai-context";
import {pimCompactStructuredOutputSchema,validatePimCompactStructuredOutput} from "./compact-structured-output";
import type {PimStructuredOutput} from "./structured-output";
import {buildPimEvidenceCatalog,resolveCompactEvidence} from "./evidence-catalog";
import {PimAttributeExtractor} from "./extractor";
import {reconcileEnrichmentOutput,type EnrichmentReconciliation} from "./conflict-reconciliation";
import {auditPromptInjectionSafety,type PromptInjectionAudit} from "./prompt-injection-safety";

type OpenAiRawResponse={output_parsed:unknown;usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number}};
type OpenAiTransport=(request:Record<string,unknown>,signal:AbortSignal)=>Promise<OpenAiRawResponse>;
const technical=new Set(["voltage","current","power","color_temperature","dimensions","bitola","thread","material","pressure","certification","technical_standard","compatibility","model"]);

function assertTechnicalEvidence(output:PimStructuredOutput){
 for(const item of output.attributes)if(technical.has(item.attribute)&&(!item.evidence.length||item.evidence.every(e=>e.sourceType==="AI_INFERENCE")))throw new PimAiError("AI_INVALID_RESPONSE",`Atributo técnico sem evidência: ${item.attribute}`);
}
function toSuggestions(output:PimStructuredOutput,reconciliation:EnrichmentReconciliation,promptInjection:PromptInjectionAudit){
 const result:PimEnrichmentSuggestion[]=[];
 for(const [fieldName,outputField,value] of [["commercial_name","suggestedName",output.suggestedName],["short_description","shortDescription",output.shortDescription],["description","longDescription",output.longDescription],["application","application",output.application],["seo_title","seo.title",output.seo.title],["meta_description","seo.metaDescription",output.seo.metaDescription]] as const)if(value){const injectionBlocked=promptInjection.blockedFields.includes(outputField);result.push({fieldName,suggestedValue:value,confidence:null,evidence:null,payload:{editorialBlockedByConflict:reconciliation.blockedEditorialFields.includes(outputField),promptInjectionBlocked:injectionBlocked,promptInjectionClaims:promptInjection.confirmedClaims.filter(item=>item.field===outputField),blockingConflicts:reconciliation.blockingConflicts,acceptableForDraft:reconciliation.acceptableForDraft&&promptInjection.safe&&!injectionBlocked}});}
 for(const item of reconciliation.attributes){const modelIndex=output.attributes.findIndex(candidate=>candidate.attribute===item.attribute),model=modelIndex>=0?output.attributes[modelIndex]:undefined,evidence=item.candidates.flatMap(candidate=>candidate.evidence),injectionBlocked=modelIndex>=0&&promptInjection.blockedFields.includes(`attributes.${modelIndex}.${item.attribute}`);result.push({fieldName:`attribute_${item.attribute}`,suggestedValue:item.status==="CONFLICT"?item.candidates.map(candidate=>candidate.value).join(" | "):item.value??model?.value??"",confidence:model?.confidence??null,evidence:evidence.map(value=>`${value.sourceType}: ${value.rawValue}`).join("\n"),payload:{status:item.status,conflictCandidates:item.candidates,blockingConflicts:reconciliation.blockingConflicts,unsupportedModelValues:item.unsupportedModelValues,rawModelValue:item.modelValue,canonicalSourceValue:item.canonicalSourceValue,reconciliationType:item.reconciliationType,promptInjectionBlocked:injectionBlocked,promptInjectionClaims:injectionBlocked?promptInjection.confirmedClaims:[],editorialBlockedByConflict:item.status==="CONFLICT",acceptableForDraft:item.status!=="CONFLICT"&&!item.unsupportedModelValues.length&&promptInjection.safe&&!injectionBlocked}});}
 return result;
}

export class OpenAiPimEnrichmentProvider implements PimEnrichmentProvider{
 readonly providerId="openai";
 readonly modelVersion:string;
 private readonly limiter:PimAiRateLimiter;
 private readonly guard=new PimAiInFlightGuard();
 private readonly config:PimAiConfig;
 private readonly transport?:OpenAiTransport;
 constructor(config:PimAiConfig=readPimAiConfig(),transport?:OpenAiTransport){this.config=config;this.transport=transport;this.modelVersion=config.model??"not-configured";this.limiter=new PimAiRateLimiter(config.rateLimitPerMinute);}
 private createTransport():OpenAiTransport{
  if(this.transport)return this.transport;
  if(!this.config.apiKey)throw new PimAiError("AI_NOT_CONFIGURED","Credencial OpenAI não configurada.");
  const client=new OpenAI({apiKey:this.config.apiKey,timeout:this.config.timeoutMs,maxRetries:0});
  return async(request,signal)=>client.responses.parse(request as never,{signal}) as unknown as Promise<OpenAiRawResponse>;
 }
 async enrichProduct(input:PimSuggestionInput,execution?:{actorReference:string}):Promise<PimProviderResult>{
  if(!this.config.enabled)throw new PimAiError("AI_DISABLED","IA real está desabilitada.");
  if(!this.config.model||!this.config.apiKey)throw new PimAiError("AI_NOT_CONFIGURED","Provider, modelo e credencial precisam estar configurados.");
  const model=this.config.model;
  const context=buildSafeAiProductContext(input,{includeGtin:this.config.includeGtin});
  const fingerprint=createPimSourceFingerprint({productId:input.productId,title:context.title,description:context.description,brand:context.brand,category:context.category,sku:"",gtin:context.gtin??null,attributes:context.attributes});
  const deterministic=new PimAttributeExtractor().extract({productId:input.productId,title:input.name,description:input.description??null,brand:input.brand,category:input.category,sku:input.sku,gtin:input.gtin,attributes:input.attributes});
  const evidenceCatalog=buildPimEvidenceCatalog(deterministic,{productReference:input.productId}),prompt=buildPimAiPrompt(context,evidenceCatalog.entries),estimatedInputTokens=Math.ceil(JSON.stringify(prompt).length/4);
  const cost=estimatePimAiCost({estimatedInputTokens,maxOutputTokens:this.config.maxOutputTokens,inputUsdMicrosPerMillion:this.config.pricing?.inputUsdMicrosPerMillion??null,outputUsdMicrosPerMillion:this.config.pricing?.outputUsdMicrosPerMillion??null});
  assertPimAiBudget(cost,this.config.maxEstimatedCostUsdMicros);
  this.limiter.consume("admin-ai");
  return this.guard.run(`${input.productId}:${fingerprint}`,async()=>{
   const requestedAt=new Date(),started=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException("timeout","TimeoutError")),this.config.timeoutMs);
   try{
    const response=await this.createTransport()({model,instructions:prompt.systemInstructions,input:prompt.input,max_output_tokens:this.config.maxOutputTokens,text:{format:zodTextFormat(pimCompactStructuredOutputSchema,prompt.schemaName)}},controller.signal);
    const compact=validatePimCompactStructuredOutput(response.output_parsed),output=resolveCompactEvidence(compact,evidenceCatalog,{expectedProductReference:input.productId});assertTechnicalEvidence(output);
    const reconciliation=reconcileEnrichmentOutput(deterministic,output),promptInjection=auditPromptInjectionSafety(input.description,output);
    const respondedAt=new Date(),usage=response.usage;
    return{suggestions:toSuggestions(output,reconciliation,promptInjection),metadata:{provider:this.providerId,model,promptVersion:this.config.promptVersion,productReference:input.productId,actorReference:execution?.actorReference??null,sourceFingerprint:fingerprint,status:"completed",requestedAt:requestedAt.toISOString(),respondedAt:respondedAt.toISOString(),durationMs:Math.round(performance.now()-started),inputTokens:usage?.input_tokens??null,outputTokens:usage?.output_tokens??null,totalTokens:usage?.total_tokens??null,estimatedCostUsdMicros:cost.status==="estimated"?cost.usdMicros:null}};
   }catch(error){if(controller.signal.aborted)throw new PimAiError("AI_TIMEOUT","O provider de IA excedeu o tempo limite.");if(error instanceof ZodError||(error instanceof Error&&/^(?:INVALID_EVIDENCE_REF|CROSS_PRODUCT_FOREIGN_REF|SAME_PRODUCT_SEMANTICALLY_FOREIGN_REF|UNSUPPORTED_EVIDENCE_VALUE|UNSUPPORTED_VALUE_EXPANSION):/.test(error.message)))throw new PimAiError("AI_INVALID_RESPONSE","O provider retornou uma resposta inválida.");throw normalizePimAiError(error);}finally{clearTimeout(timer);}
  });
 }
}
