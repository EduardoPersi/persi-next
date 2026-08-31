export const PIM_PROMPT_VERSION = "pim-enrichment-v4";
export const MAX_AI_PRODUCTS_PER_RUN = 1;

export const PIM_ATTRIBUTE_CODES = ["brand","color","material","bitola","diameter","length","width","height","thickness","capacity","volume","voltage","current","power","color_temperature","thread","connection","application","line","model"] as const;
export type PimAttributeCode=(typeof PIM_ATTRIBUTE_CODES)[number];
export type PimEvidenceSource="SOURCE_TITLE"|"SOURCE_DESCRIPTION"|"SOURCE_ATTRIBUTE"|"SOURCE_BRAND"|"SOURCE_CATEGORY"|"GTIN_REFERENCE"|"MANUFACTURER"|"MANUAL"|"AI_INFERENCE";
export type PimEvidence={sourceType:PimEvidenceSource;sourceReference:string;rawValue:string;normalizedValue:string;confidence:number;extractionMethod:"deterministic"|"structured_source"|"ai_inference"};
export type PimAttributeCandidate={attribute:PimAttributeCode;value:string;rawValue:string;unit:string|null;confidence:number;confidenceBand:"HIGH"|"MEDIUM"|"LOW";status:"CANDIDATE"|"CONFLICT"|"NEEDS_REVIEW";evidence:PimEvidence[];conflictingValues:string[]};
export type PimEnrichmentContext={productId:string;title:string;description:string|null;brand:string|null;category:string|null;sku:string;gtin:string|null;attributes:ReadonlyArray<{name:string;value:string}>};
