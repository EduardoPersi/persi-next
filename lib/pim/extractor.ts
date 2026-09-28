import {confidenceBand,detectUnit,extractMeasurements,normalizeMeasurement,parseMeasurementComponents} from "./normalization.ts";
import type {PimAttributeCandidate,PimAttributeCode,PimEnrichmentContext,PimEvidence,PimEvidenceSource} from "./enrichment-types.ts";
import {decideSourceConflict} from "./source-conflict-policy.ts";
import {excludeNonAttributiveContext,excludeMeasurementNonAttributiveContext,findLampCountNumbers,maskLampCountMisreadAsVolume,maskBrandNameMisreadAsMeasurement} from "./context-exclusion.ts";

type Observation={attribute:PimAttributeCode;raw:string;normalized:string;sourceType:PimEvidenceSource;sourceReference:string;confidence:number;method:"deterministic"|"structured_source"};
const COLORS=["branco","preto","azul","vermelho","verde","cinza","amarelo","marrom"];
const CONNECTIONS=["soldável","roscável","rosca","engate rápido","compressão","flange"];
// A3.5E-P2-F, Section 9: "aço inox" as a bare two-word phrase never matches
// the common adjectival form "aço inoxidável" (stainless) because of the
// trailing \b right after "inox" in a literal-string match — real case: SKU
// 180517-61's "flexível de aço inoxidável" fell through to the generic
// "aço" match instead of the more specific "aço inox" canonical value.
// Order is significant (checked in this order, most specific first) so
// MOST_SPECIFIC_MATERIAL_MATCH_WINS holds without inventing a new
// canonical value beyond what already exists in attribute_values.
const MATERIAL_PATTERNS:ReadonlyArray<readonly[string,string]>=[
 ["aço inox","a[çc]o\\s+inox(?:id[aá]vel)?"],["PVC","pvc"],["CPVC","cpvc"],["porcelana","porcelana"],
 ["cobre","cobre"],["latão","lat[ãa]o"],["aço","a[çc]o"],["alumínio","alum[íi]nio"],
 ["polietileno","polietileno"],["borracha","borracha"],
];
// A3.5E-P2-F, Section 8: description text only counts as identifying the
// PRODUCT's own material when a keyword is directly introduced by one of
// these positive domain-signal labels. Every P2 false positive (SKUs
// 157053783, TX1925, 000000000006054227, CIMENTUPI50, TAJ/AS*BR1) was a
// bare keyword nowhere near any such label; every genuine positive in the
// same audit (SKUs 12957, 35059, 115699) was introduced by exactly
// "Material:". Title text is exempt — see extractMaterials below; titles
// are short, curated, high-trust commercial copy and none of the P2 false
// positives originated there.
// A3.5E-P2-R, Section 12: the original patterns only covered the singular
// agreement ("fabricado em"/"fabricada em"), never the plural
// ("fabricados em"/"fabricadas em") — a real, high-frequency gap (104
// plural occurrences found catalog-wide, A3.5E-P2-R corpus audit),
// including SKU 10430321's own "Fabricados em PVC na cor marrom" (the
// product's plural "conexões" antecedent triggers Portuguese plural
// agreement on "fabricado", not a different construction). Appending an
// optional "s" to every masculine/feminine label already in this list
// covers both agreements with the same narrow, high-confidence label
// vocabulary — never a separate, looser pattern, and never a per-SKU rule.
const MATERIAL_LABEL_PATTERNS:ReadonlyArray<RegExp>=[
 /\bmaterial\s*:\s*/gi,/\bfabricad[oa]s?\s+em\s+/gi,/\bproduzid[oa]s?\s+em\s+/gi,
 /\bcorpo\s+em\s+/gi,/\bestrutura\s+em\s+/gi,/\bfeit[oa]s?\s+de\s+/gi,/\bconfeccionad[oa]s?\s+em\s+/gi,
];
function mostSpecificMaterialMatches(text:string):string[]{
 const matches:string[]=[];
 for(const[canonical,pattern]of MATERIAL_PATTERNS)if(new RegExp(`\\b(?:${pattern})\\b`,"i").test(text))matches.push(canonical);
 return matches.filter((material,index)=>!matches.slice(0,index).some(longer=>longer.toLocaleLowerCase("pt-BR").includes(material.toLocaleLowerCase("pt-BR"))));
}
function findExplicitMaterials(text:string):string[]{
 const found=new Set<string>();
 for(const labelPattern of MATERIAL_LABEL_PATTERNS)for(const match of text.matchAll(labelPattern)){
  // Window widened to 80 chars and unanchored (was: anchored at position 0
  // within a 40-char window) — real case: "Material: papel crepe com
  // adesivo à base de borracha natural" (SKU 35059) names the material
  // after a carrier noun phrase, not immediately after the label itself.
  // Still scoped to text right after a genuine positive-signal label, so
  // this stays far narrower than the removed unguarded whole-text scan.
  const start=(match.index??0)+match[0].length,after=text.slice(start,start+80);
  for(const[canonical,pattern]of MATERIAL_PATTERNS)if(new RegExp(`\\b(?:${pattern})\\b`,"i").test(after)){found.add(canonical);break;}
 }
 return[...found];
}
export const ATTRIBUTE_ALIASES:Record<string,PimAttributeCode>={cor:"color","tensão":"voltage",tensao:"voltage",corrente:"current",potência:"power",potencia:"power",bitola:"bitola",diâmetro:"diameter",diametro:"diameter",material:"material",aplicação:"application",aplicacao:"application",modelo:"model"};
const MEASUREMENT_CODES=new Set<PimAttributeCode>(["bitola","bitola_mm","length","volume"]);

// A3.5B semantic contract: a lone millimeter/inch measurement or a plain
// "N x M" pair is only ever a hydraulic/electrical-conduit bitola when there
// is real commercial context for it — never merely because the number has a
// mm/cm suffix or the string contains an "x". Absent that context, evidence
// stays under the inert "diameter" bucket (never promoted to a canonical
// attribute) rather than risk mislabeling a hammer head, a cable clamp or a
// tool-bag footprint as a pipe/fitting size. This deliberately prefers false
// negatives (leave unclassified) over false positives (wrong canonical
// attribute) — the same standard applied to FASTENER_TERMS below, which
// keeps "rosca" on a machine screw ("rosca parcial", "parafuso") from being
// read as a hydraulic thread reference just because the word appears.
// "curva" foi deliberadamente excluído: no catálogo real também nomeia
// perfis/metalon de drywall (ex.: "Curva Vert. Int. Perfilado"), sem relação
// com conexão hidráulica — incluí-lo produziria falso positivo (ver teste
// negativo do perfil 38x38mm). Preferimos a lista mais estreita.
// "tê" (peça em T) precisa de lookahead em vez de \b no final: \b é definido
// só sobre [A-Za-z0-9_] em JS, e "ê" não está nesse conjunto — \btê\b nunca
// bateria antes de espaço/pontuação, porque a transição "ê"->espaço já é
// não-palavra->não-palavra (sem borda). O lookahead evita isso e ainda
// rejeita corretamente palavras como "tênis".
const HYDRAULIC_TERMS=/\b(?:joelho|luvas?|niple|bucha|reduç(?:ão|ao)|registro|torneiras?|v[aá]lvulas?|tubos?|canos?|mangueiras?|sif[aã]o|chuveiros?|engate|eletroduto|condu[ií]te|boia|arruela|veda[çc][aã]o|pex|irriga[çc][aã]o|macho|f[êe]mea)\b|\btê(?=[^a-zà-ÿ]|$)/i;
const FASTENER_TERMS=/\b(?:parafusos?|parabolt|chumbador(?:es)?|brocas?|pregos?|barras?\s+roscadas?)\b/i;
const TOOL_CATEGORY=/ferramenta/i;
// A3.5E-P2-G-R1: "Arame e Cabo de Aço" (wire/cable hardware) — clamps,
// turnbuckles, cable grips — is, by definition, never a plumbing/conduit
// fitting category. See the isWireCableHardwareContext use site below.
const WIRE_CABLE_HARDWARE_CATEGORY=/arame.*cabo.*a[çc]o/i;
const ROSCA_TERM=/\brosca\b/i;
// A3.5D-F fix #3: category ("Elétrica"/"Hidráulica") alone is deliberately
// NOT checked here anymore. Real evidence (SKU 105724, "Abraçadeira De Nylon
// Preto 2,5mmx150mm" — a genuinely electrical-accessories-categorized cable
// tie) proved category alone promotes a plain physical dimension (tie
// thickness x length) to bitola with no real connection/fitting semantics
// behind it. A real commercial category is not proof that every number on
// that product is a connection size. The two remaining checks are both
// textual, noun-based signals already validated against the catalog: a real
// hydraulic/electrical-conduit fitting word, or "rosca" outside a fastener
// context. Neither is a per-SKU or per-product-name blacklist/allowlist —
// both generalize to any product using this vocabulary.
export function hasHydraulicContext(text:string):boolean{
 if(HYDRAULIC_TERMS.test(text))return true;
 if(ROSCA_TERM.test(text)&&!FASTENER_TERMS.test(text))return true;
 return false;
}
function isMixedUnitCompound(normalized:string):boolean{
 const sides=normalized.split(/\s+x\s+/i);
 if(sides.length<2)return false;
 return sides.some(side=>side.includes('"'))&&sides.some(side=>/(?:mm|cm|m)$/i.test(side.trim()));
}

function observations(text:string,sourceType:PimEvidenceSource,sourceReference:string,base:number,hydraulicContext:boolean,hasStructuredBitola:boolean,isFastenerContext:boolean,isWireCableHardwareContext:boolean,lampCountNumbers:Set<string>,brand:string|null):Observation[]{
 const result:Observation[]=[];
 // A3.5E-P2-F/A3.5E-P2-G-R1: measurement extraction gets the same
 // accessory-table, application/installation-section, and compatible-
 // consumable-clause protection as material/connection (see
 // excludeMeasurementNonAttributiveContext in context-exclusion.ts) — the
 // gap here (only the compatibility-clause truncation, not the section
 // scoping) is exactly how SKU 101020313's "...até 1 m no mínimo acima do
 // piso externo acabado" — an application-height instruction, not the
 // product's own length — reached comprimento=1m.
 const measurementSourceText=maskLampCountMisreadAsVolume(excludeMeasurementNonAttributiveContext(maskBrandNameMisreadAsMeasurement(text,brand)),lampCountNumbers);
 for(const item of extractMeasurements(measurementSourceText)){
  if(/\d\s*a\s*$/u.test(item.raw))continue;
  const unit=detectUnit(item.normalized);let attribute:PimAttributeCode="diameter";
  // Mixed units (mm + inch in the same compound) are strong evidence of a
  // hydraulic reduction — EXCEPT on a fastener/screw product ("Parafuso
  // ... 1/4x75mm" is thread-diameter x length, not a pipe bitola), where we
  // still require an explicit hydraulic keyword instead of trusting the
  // mixed-unit shape alone.
  if(/\sx\s/i.test(item.normalized))attribute=((isMixedUnitCompound(item.normalized)&&!isFastenerContext)||hydraulicContext)?"bitola":"diameter";
  else if(/K$/.test(item.normalized))attribute="color_temperature";
  else if(/(?:kW|CV|HP|W)$/i.test(item.normalized))attribute="power";
  else if(/V$/.test(item.normalized))attribute="voltage";
  else if(/A$/.test(item.normalized))attribute="current";
  // Fix #2 (A3.5D-F): require the ml/L token to be digit-adjacent, not just
  // "the string ends in the letter l/L" — the old suffix-only check matched
  // "1/4pol" (polegada) too, because "pol" itself ends in "l".
  else if(/\d\s*(?:ml|l)$/i.test(item.normalized))attribute="volume";
  else if(/m$/i.test(item.normalized)&&!/(?:mm|cm)$/i.test(item.normalized))attribute="length";
  else if(/(?:kg|g)$/i.test(item.normalized))continue;
  if(["voltage","current","power","color_temperature"].includes(attribute)&&(/^0\d{2,}(?:V|A|W|K)$/i.test(item.raw.replace(/\s/g,""))||/^0\d{2,}(?:V|A|W|K)$/i.test(item.normalized)))continue;
  // Lone fraction of an inch: promote to bitola only with hydraulic context
  // (never the removed "any bare fraction = thread" heuristic — real data
  // showed that heuristic was almost always mislabeling hydraulic bitola).
  if(attribute==="diameter"&&unit==='"'&&!/\sx\s/i.test(item.normalized)&&hydraulicContext)attribute="bitola";
  // Lone millimeter value: promote to bitola_mm only with hydraulic context
  // AND no structured "Bitola" WooCommerce attribute already present — when
  // that structured attribute exists, the post-hoc relabel below (which
  // predates this phase and is already covered by existing tests) takes
  // care of it and always targets "bitola", not "bitola_mm".
  if(attribute==="diameter"&&unit==="mm"&&hydraulicContext&&!hasStructuredBitola)attribute="bitola_mm";
  result.push({attribute,raw:item.raw,normalized:item.normalized,sourceType,sourceReference,confidence:base,method:"deterministic"});
 }
 // A3.5E-P2-F, Section 8/17: description text is filtered through the
 // context-exclusion pipeline (drops accessory tables, negated/prohibited
 // sentences, chemical-composition sentences, and application/installation
 // tool-noun sentences) and then ONLY the explicit positive-signal label
 // scan runs — never the bare full-text scan, which is exactly what
 // matched "aço inox" out of "desempenadeira de aço inox" and "alumínio"
 // out of cement's chemical composition. Title text keeps the original
 // explicit-first-else-bare-scan behavior: it is short, curated commercial
 // copy, and none of the P2 audit's false positives originated in a title —
 // EXCEPT A3.5E-P2-G-R1's audit finding: "Adesivo Tubo CPVC Ultraterm Cola
 // Para Cano..." (SKUs 108299, 1387, 11730755, 11731751) and "Pasta
 // Lubrificante Para Cano PVC" (SKU 90131) both name the PIPE material the
 // installation-accessory product is FOR ("... Para Cano/Tubo [material]"),
 // not the accessory's own composition (this lubricant paste's real "Tipo"
 // is "Base d'água", nothing to do with PVC). The generalizable signal is
 // the "para cano/tubo" PHRASE itself — any product whose title says it is
 // FOR a pipe/tube, not the pipe/tube itself — not an enumerated list of
 // product types (glue, paste, tape, ...), so it also covers accessories
 // this catalog doesn't have yet. That one phrase gates the title the same
 // as description (explicit label only); everything else keeps the
 // trusted bare scan.
 //
 // A3.5E-P2-G-V2 audit finding: "Tinta Spray Metálico Cobre 400ml" (SKU
 // 43042058) — "Cobre" here is the paint's COLOR name ("Cor: Cobre
 // metálico" in the description), not its material composition, but it
 // happens to also be a word in MATERIAL_PATTERNS (copper). A paint/
 // varnish/enamel product's title never states its own material this way
 // (its real composition is "à base de água"/"acrílica"/etc., always via
 // an explicit label when stated at all) — a metallic-finish color name
 // is a completely different, well-known naming convention ("dourado",
 // "prateado", "cobre", "grafite" paint tones). Gated the same way: any
 // title naming a paint-family product (tinta/esmalte/verniz/spray) is
 // gated like description, not read as a bare material claim.
 const materialSourceText=sourceType==="SOURCE_DESCRIPTION"?excludeNonAttributiveContext(text):text;
 const isForPipeAccessoryTitle=sourceType==="SOURCE_TITLE"&&/\bpara\s+(?:cano|tubo)s?\b/i.test(text);
 const isPaintProductTitle=sourceType==="SOURCE_TITLE"&&/\b(?:tintas?|esmaltes?|vernizes?|spray)\b/i.test(text);
 const explicitMaterials=findExplicitMaterials(materialSourceText);
 const detectedMaterials=(sourceType==="SOURCE_DESCRIPTION"||isForPipeAccessoryTitle||isPaintProductTitle)?explicitMaterials:(explicitMaterials.length?explicitMaterials:mostSpecificMaterialMatches(materialSourceText));
 for(const material of detectedMaterials)result.push({attribute:"material",raw:material,normalized:material,sourceType,sourceReference,confidence:base,method:"deterministic"});
 for(const color of COLORS)if(new RegExp(`\\b${color}\\b`,"i").test(text))result.push({attribute:"color",raw:color,normalized:color.toLowerCase(),sourceType,sourceReference,confidence:base,method:"deterministic"});
 // Each connection keyword found becomes its own observation (never joined
 // into one opaque "soldável + roscável" string) so that decideSourceConflict
 // can recognize two real connection types on the same product — e.g. a
 // reduction that is soldável on one end and roscável on the other via a
 // bucha — as legitimate multiplicity/role separation instead of an
 // unavoidable contradiction. This reuses the existing role/enumeration
 // machinery in source-conflict-policy.ts; no new taxonomy was added.
 // A3.5E-P2-F, Section 10/11: connection text passes through the same
 // context-exclusion pipeline used for material, which strips accessory
 // tables (SKU 050501MN001-1's "Rosca: 3/4 BSP" compatible-sensor table —
 // the CLPN unit itself has no connection type of its own), masks
 // "resistência à/a compressão" (SKUs 101020313, 1009018-1600 — a
 // mechanical property of concrete, not a fitting type) and masks
 // "soldável/soldado" co-occurring with "corrente"/"elo" (SKU 9740
 // "Corrente Soldável Zincada" — a welded-link chain, not a hydraulic
 // solder joint). See context-exclusion.ts for why a blanket
 // hasHydraulicContext gate was tried and reverted (it regressed a real
 // "Adaptador Soldável" hydraulic fitting with no HYDRAULIC_TERMS word).
 const connectionSourceText=excludeNonAttributiveContext(text);
 const connections=new Set(CONNECTIONS.filter(value=>connectionSourceText.toLocaleLowerCase("pt-BR").includes(value)).map(value=>value==="rosca"?"roscável":value));
 // A3.5E-P2-F blind-sample finding: SKU 6REVPARAF-TA25 "Parafuso Ponta
 // Agulha Para Drywall" has its own self-tapping "Rosca simples para
 // perfuração rápida" — a FASTENER thread, not a hydraulic/plumbing
 // connection type — and SKU 0175045060 "Parafuso ... Rosca Parcial
 // Flangeado" has a "cabeça flangeada" (flanged screw HEAD, a fastener
 // shape), not a hydraulic flange fitting. Both are the same homonym
 // problem on two different words. Reuses the existing `isFastenerContext`
 // signal (already computed once per product for the bitola mixed-unit-
 // compound bypass) rather than inventing a second fastener detector.
 if(isFastenerContext){connections.delete("roscável");connections.delete("flange");}
 // A3.5E-P2-G-R1 blind-sample finding: SKUs 62619-62623 "Esticador Leve
 // Maleável Gancho Olhal Galvanizado" (cable turnbuckles) describe their
 // own tensioning-adjustment thread ("Fácil Ajuste: Roscas precisas
 // permitem o ajuste fácil e rápido da tensão") — the same ontological
 // question as SKU 61464's wire-rope clamp (Section 9): a generic
 // mechanical fastening/tensioning mechanism, not a pipe/hose/conduit
 // connection interface, and it has no "porca" co-occurrence for the
 // nut-and-bolt gate to catch. The "Arame e Cabo de Aço" (wire/cable
 // hardware) category is, by definition, never a plumbing/conduit fitting
 // category, so — like FASTENER_TERMS/TOOL_CATEGORY above — it excludes
 // roscável specifically, fail-closed per Section 9, unless a genuine
 // hydraulic term is also present.
 if(isWireCableHardwareContext&&!hydraulicContext)connections.delete("roscável");
 for(const value of connections)result.push({attribute:"connection",raw:value,normalized:value,sourceType,sourceReference,confidence:base,method:"deterministic"});
 return result;
}

export class PimAttributeExtractor{
 extract(context:PimEnrichmentContext):PimAttributeCandidate[]{
  const combinedText=`${context.title}\n${context.description??""}`,hydraulicContext=hasHydraulicContext(combinedText),hasStructuredBitola=context.attributes.some(item=>item.name.toLowerCase()==="bitola");
  // A mixed-unit compound (mm + inch) on a tool ("Ferramentas") product is
  // just as often a shaft-diameter x length spec (ponteiro, talhadeira) as a
  // hydraulic reduction — the mixed-unit shape alone is not enough there.
  const isFastenerContext=FASTENER_TERMS.test(combinedText)||(context.category!==null&&TOOL_CATEGORY.test(context.category));
  const isWireCableHardwareContext=context.category!==null&&WIRE_CABLE_HARDWARE_CATEGORY.test(context.category);
  const lampCountNumbers=findLampCountNumbers(combinedText);
  const all=[...observations(context.title,"SOURCE_TITLE","title",.9,hydraulicContext,hasStructuredBitola,isFastenerContext,isWireCableHardwareContext,lampCountNumbers,context.brand),...observations(context.description??"","SOURCE_DESCRIPTION","description",.7,hydraulicContext,hasStructuredBitola,isFastenerContext,isWireCableHardwareContext,lampCountNumbers,context.brand)];
  if(context.brand)all.push({attribute:"brand",raw:context.brand,normalized:context.brand.trim(),sourceType:"SOURCE_BRAND",sourceReference:"brand",confidence:.98,method:"structured_source"});
  for(const attribute of context.attributes){const name=attribute.name.toLocaleLowerCase("pt-BR");all.push({attribute:ATTRIBUTE_ALIASES[name]??name as PimAttributeCode,raw:attribute.value,normalized:normalizeMeasurement(attribute.value),sourceType:"SOURCE_ATTRIBUTE",sourceReference:`attribute:${attribute.name}`,confidence:.97,method:"structured_source"});}
  if(hasStructuredBitola)for(const item of all)if(item.attribute==="diameter"&&["SOURCE_TITLE","SOURCE_DESCRIPTION"].includes(item.sourceType))item.attribute="bitola";
  const grouped=new Map<PimAttributeCode,Observation[]>();for(const item of all){if(!grouped.has(item.attribute))grouped.set(item.attribute,[]);grouped.get(item.attribute)?.push(item);}
  return [...grouped].map(([attribute,items])=>{const best=[...items].sort((a,b)=>b.confidence-a.confidence)[0],evidence:PimEvidence[]=items.map(x=>({sourceType:x.sourceType,sourceReference:x.sourceReference,rawValue:x.raw,normalizedValue:x.normalized,confidence:x.confidence,extractionMethod:x.method})),decision=decideSourceConflict(attribute,evidence,context),conflict=["TRUE_SOURCE_CONTRADICTION","UNRESOLVED_AMBIGUITY"].includes(decision.decision),value=decision.values.length>1?decision.values.join(" | "):decision.values[0]??best.normalized,confidence=conflict?Math.min(...items.map(x=>x.confidence)):best.confidence;return{attribute,value,rawValue:best.raw,unit:detectUnit(best.normalized),confidence,confidenceBand:confidenceBand(confidence),status:conflict?"CONFLICT":"CANDIDATE",evidence,conflictingValues:conflict?decision.values:[],sourceConflictDecision:decision.decision,semanticRoles:decision.roles,measurementComponents:(MEASUREMENT_CODES.has(attribute)&&!conflict)?parseMeasurementComponents(value):undefined};});
 }
}
