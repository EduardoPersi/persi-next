import type {PimAttributeCode} from "./enrichment-types.ts";
import {detectUnit,normalizeMeasurement} from "./normalization.ts";

export const SEMANTIC_UNIT_MATRIX={voltage:["V"],current:["A"],power:["W","kW","HP","CV"],color_temperature:["K"]} as const satisfies Partial<Record<PimAttributeCode,readonly string[]>>;
export type SemanticUnitMismatch={code:"SEMANTIC_UNIT_MISMATCH";attribute:PimAttributeCode;value:string;unit:string;allowedUnits:readonly string[]};
export type ProtectedStatementClassification="ASSERTED_FACT"|"NEGATED_FACT"|"INSUFFICIENT_EVIDENCE"|"UNCERTAINTY"|"REQUIRES_VERIFICATION"|"CONFLICT_STATEMENT"|"UNKNOWN_CONTEXT";
export type ProtectedTechnicalStatement={term:string;value?:string;classification:ProtectedStatementClassification;textSpan:string;reason:string};

export function auditSemanticUnit(attribute:PimAttributeCode,value:string):SemanticUnitMismatch|null{const allowedUnits=SEMANTIC_UNIT_MATRIX[attribute as keyof typeof SEMANTIC_UNIT_MATRIX];if(!allowedUnits)return null;const unit=detectUnit(normalizeMeasurement(value));if(!unit||allowedUnits.includes(unit as never))return null;return{code:"SEMANTIC_UNIT_MISMATCH",attribute,value,unit,allowedUnits};}

function fold(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");}
function escapeRegex(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function propositions(text:string){return text.split(/(?:[.!?;:\n]+|,?\s+\b(?:mas|por[eé]m|contudo|entretanto)\b\s*)/iu).map(value=>value.trim()).filter(Boolean);}

function classifyClause(textSpan:string,term:string):ProtectedTechnicalStatement{
 const text=fold(textSpan),termPattern=`\\b${escapeRegex(fold(term))}\\b`;
 const result=(classification:ProtectedStatementClassification,reason:string,value?:string):ProtectedTechnicalStatement=>({term,...(value?{value}:{}),classification,textSpan,reason});
 if(/\bnao\s+(?:deixa|deixou)\s+de\b/u.test(text)||/\bnao\s+e\s+(?:im)?possivel\s+nao\b/u.test(text))return result("UNKNOWN_CONTEXT","DOUBLE_NEGATION_OR_AMBIGUITY");
 if(/\b(?:conflit|diverg|contradit|inconsisten)/u.test(text))return result("CONFLICT_STATEMENT","CONFLICT_LANGUAGE");
 const insufficientBefore=`(?:nao\\s+(?:ha|existe)\\s+(?:evidencia|informacao|dados?|confirmacao)|sem\\s+(?:evidencia|informacao|dados?|detalhes?)|dados?\\s+insuficientes?|informacoes?\\s+(?:fornecidas?\\s+)?nao\\s+permitem?|nao\\s+(?:foi|e)\\s+possivel|nao\\s+se\\s+pode)`;
 const insufficientAfter=`(?:nao\\s+(?:confirmad|informad|especificad|determinad)|nao\\s+consta|desconhecid)`;
 if(new RegExp(`${insufficientBefore}[^.!?;]{0,100}${termPattern}|${termPattern}[^.!?;]{0,60}${insufficientAfter}`,"u").test(text))return result("INSUFFICIENT_EVIDENCE","SOURCE_DOES_NOT_CONFIRM_TERM");
 if(new RegExp(`(?:verifi|consulte|confirmar\\s+com|validar\\s+com)[^.!?;]{0,100}${termPattern}`,"u").test(text))return result("REQUIRES_VERIFICATION","EXPLICIT_VERIFICATION_REQUEST");
 if(new RegExp(`${termPattern}[^.!?;]{0,40}(?:permanece\\s+incert|e\\s+incert)|(?:incert|duvid)[^.!?;]{0,60}${termPattern}`,"u").test(text))return result("UNCERTAINTY","EXPLICIT_UNCERTAINTY");
 const negatedValue=new RegExp(`${termPattern}\\s+nao\\s+(?:e|sao)\\s+(.+)$`,"u").exec(text);if(negatedValue)return result("NEGATED_FACT","EXPLICIT_VALUE_NEGATION",negatedValue[1].trim());
 if(new RegExp(`${termPattern}[^.!?;]{0,45}\\bnao\\s+(?:e|sao|possui|suporta|atende)|\\bnao\\s+(?:possui|suporta|atende)[^.!?;]{0,60}${termPattern}`,"u").test(text))return result("NEGATED_FACT","EXPLICIT_PROPOSITION_NEGATION");
 if(/\b(?:possivelmente|provavelmente|aparentemente|pode\s+ser|deve\s+(?:ser|possuir|suportar|atingir)|pode\s+(?:possuir|suportar|atingir))\b/u.test(text))return result("UNKNOWN_CONTEXT","SPECULATIVE_ASSERTION_REQUIRES_REVIEW");
 if(new RegExp(termPattern,"u").test(text))return result("ASSERTED_FACT","POSITIVE_TECHNICAL_ASSERTION");return result("UNKNOWN_CONTEXT","TERM_CONTEXT_NOT_CLASSIFIABLE");
}

export function classifyProtectedTechnicalStatements(text:string,protectedTerms:readonly string[]){const statements:ProtectedTechnicalStatement[]=[];for(const clause of propositions(text))for(const term of protectedTerms)if(new RegExp(`\\b${escapeRegex(fold(term))}\\b`,"u").test(fold(clause)))statements.push(classifyClause(clause,term));return statements;}
export function classifyFactPolarity(text:string,term:string){const statements=classifyProtectedTechnicalStatements(text,[term]);if(!statements.length)return"NOT_PROVIDED" as const;const safe=new Set<ProtectedStatementClassification>(["NEGATED_FACT","INSUFFICIENT_EVIDENCE","UNCERTAINTY","REQUIRES_VERIFICATION"]);return statements.every(statement=>safe.has(statement.classification))?"NEGATED_OR_UNKNOWN" as const:"POSITIVE" as const;}
export function auditSourceOnlyText(output:string,sources:readonly string[],protectedTerms:readonly string[]){const sourceSupported=new Set(classifyProtectedTechnicalStatements(sources.join(" "),protectedTerms).filter(statement=>statement.classification==="ASSERTED_FACT").map(statement=>fold(statement.term)));const unsafe=new Set<ProtectedStatementClassification>(["ASSERTED_FACT","CONFLICT_STATEMENT","UNKNOWN_CONTEXT"]);return[...new Set(classifyProtectedTechnicalStatements(output,protectedTerms).filter(statement=>unsafe.has(statement.classification)&&!sourceSupported.has(fold(statement.term))).map(statement=>statement.term))];}
