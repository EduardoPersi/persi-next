import {createHash} from "node:crypto";
import type {PimSuggestionInput} from "./enrichment-provider.ts";
import type {SafeAiProductContext} from "./safe-ai-context.ts";

const DLP_PATTERNS:ReadonlyArray<{code:string;pattern:RegExp}>=[
 {code:"EMAIL",pattern:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i},
 {code:"CPF_CNPJ",pattern:/\b(?:\d{3}[.]?\d{3}[.]?\d{3}-?\d{2}|\d{2}[.]?\d{3}[.]?\d{3}\/?\d{4}-?\d{2})\b/},
 {code:"API_KEY",pattern:/\b(?:sk-[A-Za-z0-9_-]{16,}|api[_ -]?key\s*[:=]\s*\S+)/i},
 {code:"TOKEN_OR_SECRET",pattern:/\b(?:bearer\s+[A-Za-z0-9._~-]{12,}|(?:token|secret|password|senha)\s*[:=]\s*\S+)/i},
 {code:"COOKIE_OR_SESSION",pattern:/\b(?:cookie|session(?:id)?)\s*[:=]\s*\S+/i},
 {code:"PRIVATE_URL",pattern:/https?:\/\/(?:localhost|127[.]0[.]0[.]1|10[.]\d+[.]\d+[.]\d+|192[.]168[.]\d+[.]\d+|[^\s/]+[.](?:internal|local))\b/i},
];

const INJECTION_PATTERNS:ReadonlyArray<RegExp>=[
 /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i,
 /(?:system|developer|assistant)\s+(?:prompt|message|instruction)/i,
 /(?:reveal|print|return|expose|send)\s+(?:the\s+)?(?:api\s*key|secret|token|password)/i,
 /(?:execute|run)\s+(?:this\s+)?(?:command|code|script|instruction)/i,
];

function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>[key,canonical(item)]));
 return typeof value==="string"?value.trim():value;
}

export function createStableFingerprint(value:unknown){return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");}

export function buildPilotSourceSnapshot(input:PimSuggestionInput){
 return{productId:input.productId,title:input.name.trim(),description:input.description?.trim()||null,brand:input.brand?.trim()||null,category:input.category?.trim()||null,sku:input.sku,gtin:input.gtin,attributes:input.attributes.map(item=>({name:item.name.trim(),value:item.value.trim()}))};
}

export function scanSafeContextDlp(context:SafeAiProductContext){
 const serialized=JSON.stringify(context);
 const findings=DLP_PATTERNS.filter(item=>item.pattern.test(serialized)).map(item=>item.code);
 return{status:findings.length?"FAIL" as const:"PASS" as const,findings};
}

export function scanPromptInjection(input:Pick<PimSuggestionInput,"name"|"description"|"attributes">){
 const source=[input.name,input.description??"",...input.attributes.flatMap(item=>[item.name,item.value])].join("\n");
 const findings=INJECTION_PATTERNS.flatMap((pattern,index)=>pattern.test(source)?[`PATTERN_${index+1}`]:[]);
 return{status:findings.length?"REVIEW" as const:"PASS" as const,findings};
}

export function auditForbiddenSafeContext(context:SafeAiProductContext){
 const keys=new Set<string>();
 const visit=(value:unknown)=>{if(Array.isArray(value)){value.forEach(visit);return;}if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)){keys.add(key.toLowerCase());visit(item);}};
 visit(context);
 const forbidden=["sku","gtin","id","productid","variantid","externalid","stock","stockquantity","price","cost","margin","customer","order","secret","token","cookie","session"];
 return forbidden.filter(field=>keys.has(field));
}

export function safeContextFingerprint(context:SafeAiProductContext){return createStableFingerprint(context);}
export function createPimAiRequestFingerprint(input:{safeContextFingerprint:string;model:string;promptVersion:string;schemaVersion:string;outputPolicyVersion:string}){return createStableFingerprint(input);}

export function evaluateStaleness(expectedSourceFingerprint:string,currentSourceFingerprint:string){return expectedSourceFingerprint===currentSourceFingerprint?"CURRENT" as const:"STALE" as const;}
