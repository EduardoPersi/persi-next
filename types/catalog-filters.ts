export interface CatalogFilterOption {
  id: number;
  name: string;
  slug: string;
  count: number;
  image?: {
    src: string;
    alt: string;
  };
}

export interface CatalogAttributeFilter {
  id: number;
  name: string;
  taxonomy: string;
  options: CatalogFilterOption[];
}

export interface CatalogFilterData {
  minPrice: number;
  maxPrice: number;
  inStockCount: number;
  onSaleAvailable: boolean;
  brands: CatalogFilterOption[];
  attributes: CatalogAttributeFilter[];
}
