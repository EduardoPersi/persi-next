import {confidenceBand,detectUnit,extractMeasurements,normalizeMeasurement} from "./normalization.ts";
import type {PimAttributeCandidate,PimAttributeCode,PimEnrichmentContext,PimEvidence,PimEvidenceSource} from "./enrichment-types.ts";
import {decideSourceConflict} from "./source-conflict-policy.ts";

type Observation={attribute:PimAttributeCode;raw:string;normalized:string;sourceType:PimEvidenceSource;sourceReference:string;confidence:number;method:"deterministic"|"structured_source"};
const MATERIALS=["PVC","CPVC","porcelana","cobre","latão","aço inox","aço","alumínio","polietileno","borracha"];
const COLORS=["branco","preto","azul","vermelho","verde","cinza","amarelo","marrom"];
const CONNECTIONS=["soldável","roscável","rosca","engate rápido","compressão","flange"];
const ATTRIBUTE_ALIASES:Record<string,PimAttributeCode>={cor:"color","tensão":"voltage",tensao:"voltage",corrente:"current",potência:"power",potencia:"power",bitola:"bitola",diâmetro:"diameter",diametro:"diameter",material:"material",aplicação:"application",aplicacao:"application",modelo:"model"};

function observations(text:string,sourceType:PimEvidenceSource,sourceReference:string,base:number):Observation[]{
 const result:Observation[]=[];
 for(const item of extractMeasurements(text)){
  if(/\d\s*a\s*$/u.test(item.raw))continue;
  const unit=detectUnit(item.normalized);let attribute:PimAttributeCode="diameter";
  if(/\sx\s/i.test(item.normalized))attribute="bitola";
  else if(/K$/.test(item.normalized))attribute="color_temperature";
  else if(/(?:kW|CV|HP|W)$/i.test(item.normalized))attribute="power";
  else if(/V$/.test(item.normalized))attribute="voltage";
  else if(/A$/.test(item.normalized))attribute="current";
  else if(/(?:L|ml)$/i.test(item.normalized))attribute="volume";
  else if(/m$/i.test(item.normalized)&&!/(?:mm|cm)$/i.test(item.normalized))attribute="length";
  else if(/(?:kg|g)$/i.test(item.normalized))continue;
  if(["voltage","current","power","color_temperature"].includes(attribute)&&(/^0\d{2,}(?:V|A|W|K)$/i.test(item.raw.replace(/\s/g,""))||/^0\d{2,}(?:V|A|W|K)$/i.test(item.normalized)))continue;
  result.push({attribute,raw:item.raw,normalized:item.normalized,sourceType,sourceReference,confidence:base,method:"deterministic"});
  if(unit==='"'&&!/\sx\s/i.test(item.normalized))result[result.length-1].attribute="thread";
 }
 const materialAlternatives=[...MATERIALS].sort((a,b)=>b.length-a.length).join("|");
 const explicitMaterial=text.match(new RegExp(`\\bMaterial\\s*:\\s*(${materialAlternatives})\\b`,"i"))?.[1];
 const detectedMaterials=explicitMaterial?[MATERIALS.find(material=>material.toLocaleLowerCase("pt-BR")===explicitMaterial.toLocaleLowerCase("pt-BR"))??explicitMaterial]:MATERIALS.filter(material=>new RegExp(`\\b${material}\\b`,"i").test(text)).sort((a,b)=>b.length-a.length).filter((material,index,found)=>!found.slice(0,index).some(longer=>longer.toLocaleLowerCase("pt-BR").includes(material.toLocaleLowerCase("pt-BR"))));
 for(const material of detectedMaterials)result.push({attribute:"material",raw:material,normalized:material,sourceType,sourceReference,confidence:base,method:"deterministic"});
 for(const color of COLORS)if(new RegExp(`\\b${color}\\b`,"i").test(text))result.push({attribute:"color",raw:color,normalized:color.toLowerCase(),sourceType,sourceReference,confidence:base,method:"deterministic"});
 const connections=CONNECTIONS.filter(value=>text.toLocaleLowerCase("pt-BR").includes(value));if(connections.length)result.push({attribute:"connection",raw:connections.join(" + "),normalized:[...new Set(connections.map(x=>x==="rosca"?"roscável":x))].join(" + "),sourceType,sourceReference,confidence:base,method:"deterministic"});
 return result;
}

export class PimAttributeExtractor{
 extract(context:PimEnrichmentContext):PimAttributeCandidate[]{
  const all=[...observations(context.title,"SOURCE_TITLE","title",.9),...observations(context.description??"","SOURCE_DESCRIPTION","description",.7)];
  if(context.brand)all.push({attribute:"brand",raw:context.brand,normalized:context.brand.trim(),sourceType:"SOURCE_BRAND",sourceReference:"brand",confidence:.98,method:"structured_source"});
  for(const attribute of context.attributes){const name=attribute.name.toLocaleLowerCase("pt-BR");all.push({attribute:ATTRIBUTE_ALIASES[name]??name as PimAttributeCode,raw:attribute.value,normalized:normalizeMeasurement(attribute.value),sourceType:"SOURCE_ATTRIBUTE",sourceReference:`attribute:${attribute.name}`,confidence:.97,method:"structured_source"});}
  if(context.attributes.some(item=>item.name.toLowerCase()==="bitola"))for(const item of all)if(item.attribute==="diameter"&&["SOURCE_TITLE","SOURCE_DESCRIPTION"].includes(item.sourceType))item.attribute="bitola";
  const grouped=new Map<PimAttributeCode,Observation[]>();for(const item of all){if(!grouped.has(item.attribute))grouped.set(item.attribute,[]);grouped.get(item.attribute)?.push(item);}
  return [...grouped].map(([attribute,items])=>{const best=[...items].sort((a,b)=>b.confidence-a.confidence)[0],evidence:PimEvidence[]=items.map(x=>({sourceType:x.sourceType,sourceReference:x.sourceReference,rawValue:x.raw,normalizedValue:x.normalized,confidence:x.confidence,extractionMethod:x.method})),decision=decideSourceConflict(attribute,evidence,context),conflict=["TRUE_SOURCE_CONTRADICTION","UNRESOLVED_AMBIGUITY"].includes(decision.decision),value=decision.values.length>1?decision.values.join(" | "):decision.values[0]??best.normalized,confidence=conflict?Math.min(...items.map(x=>x.confidence)):best.confidence;return{attribute,value,rawValue:best.raw,unit:detectUnit(best.normalized),confidence,confidenceBand:confidenceBand(confidence),status:conflict?"CONFLICT":"CANDIDATE",evidence,conflictingValues:conflict?decision.values:[],sourceConflictDecision:decision.decision,semanticRoles:decision.roles};});
 }
}
