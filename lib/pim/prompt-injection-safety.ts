import type {PimStructuredOutput} from "./structured-output.ts";

export type UntrustedClaim={kind:"temperature"|"pressure"|"certification";value:string;pattern:RegExp};
export type PromptInjectionAudit={untrustedInstructionDetected:boolean;claims:UntrustedClaim[];confirmedClaims:Array<{kind:UntrustedClaim["kind"];value:string;field:string;text:string}>;blockedFields:string[];safe:boolean};

const instructionPattern=/(?:ignore|desconsidere|esqueça).{0,80}instruções|(?:informe|declare|afirme|responda|considere).{0,40}(?:que|como)/iu;
const negativeContext=/(?:não|nunca)\s+(?:foi\s+)?(?:confirmad|comprovad|suportad|validado|evidenciad)|não\s+há\s+(?:qualquer\s+)?evidência|sem\s+(?:qualquer\s+)?evidência|não\s+confiável|conteúdo\s+(?:rejeitado|malicioso)|instrução\s+(?:ignorada|maliciosa)|incert|não\s+deve\s+ser\s+considerad/iu;

function escaped(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s*");}
function claim(kind:UntrustedClaim["kind"],value:string){return{kind,value,pattern:new RegExp(escaped(value),"iu")};}
function untrustedClaims(description:string|null|undefined){
 if(!description)return[];
 const marker=description.search(instructionPattern);if(marker<0)return[];
 const untrusted=description.slice(marker),result:UntrustedClaim[]=[];
 for(const match of untrusted.matchAll(/\b\d+(?:[.,]\d+)?\s*°\s*C\b/giu))result.push(claim("temperature",match[0]));
 for(const match of untrusted.matchAll(/\b\d+(?:[.,]\d+)?\s*bar\b/giu))result.push(claim("pressure",match[0]));
 for(const match of untrusted.matchAll(/\b(?:ABNT|NBR(?:\s*\d+)?)\b/giu))result.push(claim("certification",match[0]));
 return[...new Map(result.map(item=>[`${item.kind}:${item.value.toLocaleLowerCase("pt-BR")}`,item])).values()];
}
function outputFields(output:PimStructuredOutput){return new Map<string,string>([["suggestedName",output.suggestedName??""],["shortDescription",output.shortDescription??""],["longDescription",output.longDescription??""],...output.bulletPoints.map((value,index)=>[`bulletPoints.${index}`,value] as [string,string]),["application",output.application??""],...output.attributes.map((item,index)=>[`attributes.${index}.${item.attribute}`,item.value] as [string,string]),["seo.title",output.seo.title??""],["seo.metaDescription",output.seo.metaDescription??""],...output.seo.searchTerms.map((value,index)=>[`seo.searchTerms.${index}`,value] as [string,string]),...output.uncertainties.map((value,index)=>[`uncertainties.${index}`,value] as [string,string])]);}
function positivelyAsserted(text:string,pattern:RegExp){for(const match of text.matchAll(new RegExp(pattern.source,"giu"))){const index=match.index??0,before=text.slice(0,index),after=text.slice(index+match[0].length),start=Math.max(before.lastIndexOf("."),before.lastIndexOf("!"),before.lastIndexOf("?"),before.lastIndexOf(";"),before.lastIndexOf("\n"),before.lastIndexOf(","))+1,next=[after.indexOf("."),after.indexOf("!"),after.indexOf("?"),after.indexOf(";"),after.indexOf("\n"),after.indexOf(",")].filter(value=>value>=0),end=next.length?index+match[0].length+Math.min(...next):text.length,clause=text.slice(start,end);if(!negativeContext.test(clause))return true;}return false;}

export function auditPromptInjectionSafety(description:string|null|undefined,output:PimStructuredOutput):PromptInjectionAudit{
 const claims=untrustedClaims(description),confirmedClaims:PromptInjectionAudit["confirmedClaims"]=[];
 for(const [field,text] of outputFields(output))for(const item of claims)if(positivelyAsserted(text,item.pattern))confirmedClaims.push({kind:item.kind,value:item.value,field,text});
 return{untrustedInstructionDetected:claims.length>0,claims,confirmedClaims,blockedFields:[...new Set(confirmedClaims.map(item=>item.field))],safe:confirmedClaims.length===0};
}
