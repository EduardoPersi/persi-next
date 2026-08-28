export type CatalogStockStatus = "in-stock" | "out-of-stock" | "on-backorder";

export interface CatalogImage {
  externalId: number | null;
  url: string;
  alt: string;
  title: string | null;
  role: string;
  position: number;
}

export interface CatalogTerm {
  code: string;
  name: string;
  value: string;
}

export interface CatalogTaxonomy {
  externalId: number;
  name: string;
  slug: string;
  description?: string;
  parentExternalId?: number | null;
  image?: { url: string; alt: string } | null;
  productCount?: number;
}

export interface CatalogVariant {
  externalId: number | null;
  internalId: string | null;
  sku: string;
  gtin: string | null;
  status: string;
  price: CatalogProduct["price"];
  inventory: CatalogProduct["inventory"];
  attributes: CatalogTerm[];
  isDefault: boolean;
}

export interface CatalogProduct {
  source: "woocommerce" | "postgres";
  externalId: number;
  internalId: string | null;
  slug: string;
  name: string;
  sku: string;
  gtin: string | null;
  status: string;
  type: string;
  shortDescription: string;
  description: string;
  publishedAt: string | null;
  price: {
    currency: string;
    regularMinor: bigint;
    saleMinor: bigint | null;
    saleValidFrom: string | null;
    saleValidTo: string | null;
  };
  inventory: {
    quantityAvailable: bigint;
    status: CatalogStockStatus;
    manageStock: boolean;
    purchasable: boolean;
    allowsBackorder: boolean;
    available: boolean;
  };
  brand: CatalogTaxonomy | null;
  categories: CatalogTaxonomy[];
  images: CatalogImage[];
  attributes: CatalogTerm[];
  variants: CatalogVariant[];
  defaultVariantSku: string;
  tags: CatalogTaxonomy[];
  visibility: string;
  featured: boolean;
  popularity: bigint;
  averageRating: number;
  reviewCount: number;
  freeShipping: boolean;
}

export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export type CatalogOrderBy = "date" | "price" | "title" | "id" | "popularity" | "rating" | "availability";

export interface CatalogListOptions {
  page?: number;
  perPage?: number;
  order?: "asc" | "desc";
  orderBy?: CatalogOrderBy;
  availabilityFirst?: boolean;
  minPriceMinor?: bigint;
  maxPriceMinor?: bigint;
  inStockOnly?: boolean;
  onSaleOnly?: boolean;
  featured?: boolean;
}
