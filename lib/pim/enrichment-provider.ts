export type PimSuggestionInput = {
  productId: string;
  name: string;
  description?: string | null;
  sku: string;
  gtin: string | null;
  brand: string | null;
  category: string | null;
  attributes: ReadonlyArray<{ name: string; value: string }>;
};

export type PimEnrichmentSuggestion = {
  fieldName: string;
  suggestedValue: string;
  confidence: number | null;
  evidence: string | null;
  payload?: Record<string,unknown>;
};

export type PimProviderMetadata={provider:string;model:string;promptVersion:string;productReference:string;actorReference:string|null;sourceFingerprint:string;status:"completed";requestedAt:string;respondedAt:string;durationMs:number;inputTokens:number|null;outputTokens:number|null;totalTokens:number|null;estimatedCostUsdMicros:bigint|null};
export type PimProviderResult={suggestions:ReadonlyArray<PimEnrichmentSuggestion>;metadata:PimProviderMetadata|null};

export interface PimEnrichmentProvider {
  readonly providerId: string;
  readonly modelVersion: string;
  enrichProduct(input: PimSuggestionInput,execution?:{actorReference:string}): Promise<PimProviderResult>;
}

export class MockPimEnrichmentProvider implements PimEnrichmentProvider {
  readonly providerId="mock";readonly modelVersion="mock-v1";
  private readonly suggestions:ReadonlyArray<PimEnrichmentSuggestion>;
  constructor(suggestions:ReadonlyArray<PimEnrichmentSuggestion>=[]){this.suggestions=suggestions;}
  async enrichProduct(){return{suggestions:this.suggestions,metadata:null};}
}
