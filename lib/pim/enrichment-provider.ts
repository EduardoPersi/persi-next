export type PimSuggestionInput = {
  productId: string;
  name: string;
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
};

export interface PimEnrichmentProvider {
  readonly providerId: string;
  suggest(input: PimSuggestionInput): Promise<ReadonlyArray<PimEnrichmentSuggestion>>;
}
