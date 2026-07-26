export interface AdjacentProductSummary {
  id: number;
  name: string;
  slug: string;
  href: string;
  image: {
    src: string;
    alt: string;
  } | null;
  formattedPrice: string;
  inStock: boolean;
}

export interface ProductNavigationCategory {
  id: number;
  name: string;
  slug: string;
  href: string;
}

export interface ProductNavigationData {
  previous: AdjacentProductSummary | null;
  next: AdjacentProductSummary | null;
  category: ProductNavigationCategory | null;
  source: "family" | "category";
}
