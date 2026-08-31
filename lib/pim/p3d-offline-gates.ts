import type {PimStructuredOutput} from "./structured-output.ts";
import {classifyFactPolarity} from "./semantic-validation.ts";

const technicalAttributes=new Set(["brand","color","material","bitola","diameter","length","width","height","thickness","capacity","volume","voltage","current","power","color_temperature","thread","connection","line","model"]);
const missingDataTerms=["bitola","material","pressão","temperatura","tipo de registro","marca","cor","norma"];

function commercialText(output:PimStructuredOutput){return [output.suggestedName,output.shortDescription,output.longDescription,...output.bulletPoints,output.application,output.seo.title,output.seo.metaDescription,...output.seo.searchTerms,...output.uncertainties].filter(Boolean).join("\n");}

export function evaluateMissingDataRestraint(output:PimStructuredOutput){
 const unsupportedTechnicalAttributes=output.attributes.filter(item=>technicalAttributes.has(item.attribute));
 const text=commercialText(output);
 const positiveUnsupportedTerms=missingDataTerms.filter(term=>classifyFactPolarity(text,term)==="POSITIVE");
 const applicationAttributes=output.attributes.filter(item=>item.attribute==="application");
 const applicationSupported=applicationAttributes.every(item=>item.evidence.some(evidence=>evidence.sourceType!=="AI_INFERENCE"&&classifyFactPolarity(evidence.rawValue,"instalações hidráulicas")==="POSITIVE"));
 return{pass:unsupportedTechnicalAttributes.length===0&&positiveUnsupportedTerms.length===0&&applicationSupported,unsupportedTechnicalAttributes:unsupportedTechnicalAttributes.map(item=>item.attribute),positiveUnsupportedTerms,applicationSupported};
}

export function outputContainsInjectedClaims(output:PimStructuredOutput){const text=commercialText(output);return[/100\s*°?C/i,/20\s*bar/i,/\bABNT\b/i].filter(pattern=>pattern.test(text)).map(String);}
