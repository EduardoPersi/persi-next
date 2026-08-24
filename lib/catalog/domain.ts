export type CatalogStockStatus = "in-stock" | "out-of-stock";

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
  };
  brand: CatalogTaxonomy | null;
  categories: CatalogTaxonomy[];
  images: CatalogImage[];
  attributes: CatalogTerm[];
}

export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export type CatalogOrderBy = "date" | "price" | "title" | "id";

export interface CatalogListOptions {
  page?: number;
  perPage?: number;
  order?: "asc" | "desc";
  orderBy?: CatalogOrderBy;
  availabilityFirst?: boolean;
}
