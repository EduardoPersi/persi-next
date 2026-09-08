import type {PimAttributeCode,PimEnrichmentContext,PimEvidence} from "./enrichment-types.ts";

export type SourceConflictDecision=
 | "NO_CONFLICT"
 | "LEGITIMATE_MULTI_VALUE"
 | "SEMANTIC_ROLE_SEPARATION"
 | "TRUE_SOURCE_CONTRADICTION"
 | "UNRESOLVED_AMBIGUITY"
 | "EXTRACTION_FALSE_POSITIVE"
 | "NORMALIZATION_FALSE_POSITIVE"
 | "COMPOUND_MEASURE";

export type AttributeValueRole="product"|"package"|"component"|"input"|"output"|"male"|"female"|"nominal"|"capacity"|"compatibility"|"range"|"unknown";

const fold=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
const compactNumber=(token:string)=>{const number=Number(token.replace(",","."));return Number.isFinite(number)?String(number):token;};
export function conflictComparisonKey(value:string){
 let key=fold(value).replace(/\d+(?:[.,]\d+)?/g,compactNumber).replace(/\s+/g,"").replace(/pol\.?/g,'"');
 const sharedUnit=key.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|cm|m)$/);
 if(sharedUnit)key=`${sharedUnit[1]}${sharedUnit[3]}x${sharedUnit[2]}${sharedUnit[3]}`;
 return key;
}

const sourceText=(evidence:PimEvidence,context:PimEnrichmentContext)=>evidence.sourceType==="SOURCE_TITLE"?context.title:evidence.sourceType==="SOURCE_DESCRIPTION"?context.description??"":evidence.sourceType==="SOURCE_ATTRIBUTE"?context.attributes.find(item=>`attribute:${item.name}`===evidence.sourceReference)?.value??"":"";
function roleOf(evidence:PimEvidence,context:PimEnrichmentContext):AttributeValueRole{
 const text=fold(sourceText(evidence,context)),needle=fold(evidence.rawValue),at=text.indexOf(needle),before=text.slice(Math.max(0,at-55),at<0?55:at),after=text.slice(at<0?0:at+needle.length,at<0?20:at+needle.length+20);
 const definitions:Array<[AttributeValueRole,RegExp]>=[["package",/embalagem|pacote|caixa|dimens(?:ao|oes) da embalagem/g],["component",/componente|anel|inserto|cabo|revestimento|corpo interno/g],["input",/entrada|inlet/g],["output",/saida|outlet/g],["male",/macho/g],["female",/femea/g],["nominal",/nominal/g],["capacity",/capacidade|ruptura|ka\b/g],["compatibility",/compativ|compatibilidade|suporta/g],["range",/faixa/g],["product",/produto|corpo|material principal|cor principal|operacao/g]];
 let nearest:{role:AttributeValueRole;index:number}|null=null;
 for(const [role,pattern]of definitions)for(const match of before.matchAll(pattern))if(!nearest||match.index>nearest.index)nearest={role,index:match.index};
 if(nearest)return nearest.role;
 if(/embalagem|pacote|caixa/.test(after))return"package";
 if(/^\s*(?:bsp\s*)?\(?(?:m|macho)\)?\b/.test(after))return"male";
 if(/^\s*(?:bsp\s*)?\(?(?:f|femea)\)?\b/.test(after))return"female";
 return"unknown";
}

function explicitlyEnumerated(evidence:PimEvidence[],context:PimEnrichmentContext){
 for(const sourceReference of new Set(evidence.map(item=>item.sourceReference))){
  const sameSource=evidence.filter(item=>item.sourceReference===sourceReference);
  if(sameSource.length<2)continue;
  const text=fold(sourceText(sameSource[0],context)),positions=sameSource.map(item=>text.indexOf(fold(item.rawValue))).filter(index=>index>=0).sort((a,b)=>a-b);
  if(positions.length>=2&&positions.slice(1).every((position,index)=>{const between=text.slice(positions[index],position);return between.length<=80&&/(?:\/|\||,|\be\b|\bou\b|\ba\b|\bx\b)/.test(between);}))return true;
 }
 return false;
}

export function decideSourceConflict(attribute:PimAttributeCode,evidence:PimEvidence[],context:PimEnrichmentContext){
 const values=[...new Map(evidence.map(item=>[conflictComparisonKey(item.normalizedValue),item.normalizedValue])).values()];
 if(values.length<=1)return{decision:"NO_CONFLICT" as const,values,roles:[] as AttributeValueRole[]};
 const roles=evidence.map(item=>roleOf(item,context)),known=[...new Set(roles.filter(role=>role!=="unknown"))];
 const eachKnownRoleUnambiguous=known.length>1&&known.every(role=>new Set(evidence.filter((_,index)=>roles[index]===role).map(item=>conflictComparisonKey(item.normalizedValue))).size===1);
 if(eachKnownRoleUnambiguous)return{decision:"SEMANTIC_ROLE_SEPARATION" as const,values,roles};
 if(explicitlyEnumerated(evidence,context))return{decision:/\sx\s/i.test(values.join(" "))?"COMPOUND_MEASURE" as const:"LEGITIMATE_MULTI_VALUE" as const,values,roles};
 const structured=evidence.filter(item=>item.sourceType==="SOURCE_ATTRIBUTE");
 if(structured.length&&new Set(structured.map(item=>conflictComparisonKey(item.normalizedValue))).size>1)return{decision:"TRUE_SOURCE_CONTRADICTION" as const,values,roles};
 return{decision:"UNRESOLVED_AMBIGUITY" as const,values,roles};
}
