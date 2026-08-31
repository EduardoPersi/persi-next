import type {PimAttributeCandidate,PimAttributeCode,PimEvidence} from "./enrichment-types.ts";
import {extractMeasurements,normalizeMeasurement} from "./normalization.ts";
import type {PimStructuredOutput} from "./structured-output.ts";

export type ConflictCandidate={value:string;evidence:PimEvidence[]};
export type ReconciliationType="MODEL_RETURNED_EXACT_SOURCE_VALUE"|"MODEL_RETURNED_INCOMPLETE_VALUE_RECONCILED_FROM_SOURCE"|"MODEL_RETURNED_UNSUPPORTED_VALUE"|"MODEL_RETURNED_CONFLICTING_VALUE"|"MODEL_RETURNED_AMBIGUOUS_VALUE"|"SOURCE_VALUE_WITHOUT_MODEL_VALUE";
export type ReconciledAttribute={attribute:PimAttributeCode;status:"CANDIDATE"|"CONFLICT"|"NEEDS_REVIEW";value:string|null;candidates:ConflictCandidate[];modelValue:string|null;canonicalSourceValue:string|null;reconciliationType:ReconciliationType;unsupportedModelValues:string[]};
export type EnrichmentReconciliation={attributes:ReconciledAttribute[];blockingConflicts:PimAttributeCode[];unsupportedFacts:Array<{attribute:PimAttributeCode;value:string}>;semanticMismatches:unknown[];editorialBlockedByConflict:boolean;blockedEditorialFields:string[];humanReviewRequired:boolean;evidenceStructurallyValid:boolean;evidenceConsistencyValid:boolean;conflictFree:boolean;editorialSafe:boolean;acceptableForDraft:boolean};

function candidates(candidate:PimAttributeCandidate):ConflictCandidate[]{
 const byValue=new Map<string,{value:string;evidence:PimEvidence[]}>();
 for(const evidence of candidate.evidence){const value=normalizeMeasurement(evidence.normalizedValue||evidence.rawValue),key=value.toLocaleLowerCase("pt-BR"),existing=byValue.get(key);byValue.set(key,{value:existing?.value??value,evidence:[...(existing?.evidence??[]),evidence]});}
 return[...byValue.values()];
}
function canonicalValues(text:string){return new Set(extractMeasurements(text).map(item=>item.normalized));}
function editorialFields(output:PimStructuredOutput){return new Map<string,string>([["suggestedName",output.suggestedName??""],["shortDescription",output.shortDescription??""],["longDescription",output.longDescription??""],...output.bulletPoints.map((value,index)=>[`bulletPoints.${index}`,value] as [string,string]),["application",output.application??""],["seo.title",output.seo.title??""],["seo.metaDescription",output.seo.metaDescription??""],...output.seo.searchTerms.map((value,index)=>[`seo.searchTerms.${index}`,value] as [string,string])]);}
type AtomicValue={magnitude:string;unit:string|null};
function canonicalMagnitude(value:string){const [integer,decimal=""]=value.replace(",",".").split("."),trimmedInteger=integer.replace(/^0+(?=\d)/,"")||"0",trimmedDecimal=decimal.replace(/0+$/,"");return trimmedDecimal?`${trimmedInteger}.${trimmedDecimal}`:trimmedInteger;}
function atomicValue(value:string):AtomicValue|null{const normalized=normalizeMeasurement(value);if(/[xX\/]/.test(normalized))return null;const match=normalized.match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|ml|kg|kW|CV|HP|V|A|W|K|L|m|g|")?$/);return match?{magnitude:canonicalMagnitude(match[1]),unit:match[2]??null}:null;}
function reconcileCanonicalSource(modelValue:string,sourceCandidates:ConflictCandidate[],conflict:boolean){
 const normalizedModel=normalizeMeasurement(modelValue),modelAtomic=atomicValue(normalizedModel);
 if(conflict){const sameMagnitude=modelAtomic&&!modelAtomic.unit?sourceCandidates.filter(item=>atomicValue(item.value)?.magnitude===modelAtomic.magnitude):[];return{value:null,type:(sameMagnitude.length>1?"MODEL_RETURNED_AMBIGUOUS_VALUE":"MODEL_RETURNED_CONFLICTING_VALUE") as ReconciliationType,canonical:null};}
 if(sourceCandidates.length!==1)return{value:normalizedModel,type:"MODEL_RETURNED_UNSUPPORTED_VALUE" as ReconciliationType,canonical:null};
 const canonical=sourceCandidates[0].value;if(normalizedModel.toLocaleLowerCase("pt-BR")===canonical.toLocaleLowerCase("pt-BR"))return{value:canonical,type:"MODEL_RETURNED_EXACT_SOURCE_VALUE" as ReconciliationType,canonical};
 const sourceAtomic=atomicValue(canonical);
 if(modelAtomic&&sourceAtomic&&!modelAtomic.unit&&sourceAtomic.unit&&modelAtomic.magnitude===sourceAtomic.magnitude)return{value:canonical,type:"MODEL_RETURNED_INCOMPLETE_VALUE_RECONCILED_FROM_SOURCE" as ReconciliationType,canonical};
 return{value:normalizedModel,type:"MODEL_RETURNED_UNSUPPORTED_VALUE" as ReconciliationType,canonical:null};
}

export function reconcileEnrichmentOutput(deterministic:PimAttributeCandidate[],model:PimStructuredOutput):EnrichmentReconciliation{
 const attributes:ReconciledAttribute[]=[],unsupportedFacts:Array<{attribute:PimAttributeCode;value:string}>=[];
 const deterministicByAttribute=new Map(deterministic.map(candidate=>[candidate.attribute,candidate]));
 const modelByAttribute=new Map<PimAttributeCode,typeof model.attributes>();for(const item of model.attributes)modelByAttribute.set(item.attribute,[...(modelByAttribute.get(item.attribute)??[]),item]);
 const allAttributes=new Set<PimAttributeCode>([...deterministicByAttribute.keys(),...modelByAttribute.keys()]);
 for(const attribute of allAttributes){
  const source=deterministicByAttribute.get(attribute),sourceCandidates=source?candidates(source):[],modelItems=modelByAttribute.get(attribute)??[],conflict=sourceCandidates.length>1||source?.status==="CONFLICT",modelValue=modelItems[0]?.value??null;
  const decision=modelValue?reconcileCanonicalSource(modelValue,sourceCandidates,conflict):{value:source?.value??null,type:"SOURCE_VALUE_WITHOUT_MODEL_VALUE" as ReconciliationType,canonical:sourceCandidates.length===1?sourceCandidates[0].value:null};
  const sourceValues=new Set(sourceCandidates.map(item=>item.value.toLocaleLowerCase("pt-BR")));
  const unsupported=modelItems.length&&sourceCandidates.length>0?(conflict&&decision.type!=="MODEL_RETURNED_AMBIGUOUS_VALUE"?modelItems.map(item=>normalizeMeasurement(item.value)).filter(value=>!sourceValues.has(value.toLocaleLowerCase("pt-BR"))):decision.type==="MODEL_RETURNED_UNSUPPORTED_VALUE"?modelItems.map(item=>normalizeMeasurement(item.value)):[]):[];
  unsupportedFacts.push(...unsupported.map(value=>({attribute,value})));
  attributes.push({attribute,status:conflict?"CONFLICT":unsupported.length?"NEEDS_REVIEW":modelItems[0]?.status??source?.status??"NEEDS_REVIEW",value:conflict?null:decision.value,candidates:sourceCandidates,modelValue,canonicalSourceValue:decision.canonical,reconciliationType:decision.type,unsupportedModelValues:unsupported});
 }
 const blockingConflicts=attributes.filter(item=>item.status==="CONFLICT").map(item=>item.attribute),conflictValues=new Set(attributes.filter(item=>item.status==="CONFLICT").flatMap(item=>item.candidates.map(candidate=>candidate.value))),blockedEditorialFields:string[]=[];
 for(const [field,value] of editorialFields(model)){const values=canonicalValues(value);if([...conflictValues].some(candidate=>values.has(candidate)))blockedEditorialFields.push(field);}
 const evidenceStructurallyValid=model.attributes.every(item=>item.evidence.length>0),evidenceConsistencyValid=attributes.every(item=>item.status!=="CONFLICT"||item.candidates.length>1);
 const editorialBlockedByConflict=blockedEditorialFields.length>0,humanReviewRequired=blockingConflicts.length>0||unsupportedFacts.length>0,conflictFree=blockingConflicts.length===0,editorialSafe=!editorialBlockedByConflict&&unsupportedFacts.length===0,acceptableForDraft=conflictFree&&editorialSafe;
 return{attributes,blockingConflicts,unsupportedFacts,semanticMismatches:[],editorialBlockedByConflict,blockedEditorialFields,humanReviewRequired,evidenceStructurallyValid,evidenceConsistencyValid,conflictFree,editorialSafe,acceptableForDraft};
}
