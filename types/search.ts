export interface ProductSearchSuggestion {
  id: number;
  name: string;
  slug: string;
  image?: {
    src: string;
    alt: string;
  };
  price: number;
  currencyCode: string;
  available: boolean;
}

export interface ProductSearchSuggestionsResponse {
  products: ProductSearchSuggestion[];
}
