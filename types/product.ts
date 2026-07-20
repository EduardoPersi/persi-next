import type { ProductCategory } from "./category";

export interface ProductImage {
  id?: number;
  src: string;
  alt: string;
  name?: string;
  thumbnail?: string;
  srcset?: string;
  sizes?: string;
}

export interface ProductBrand {
  id: number;
  name: string;
  slug: string;
  link?: string;
}

export interface ProductSpecification {
  label: string;
  value: string;
}

export interface ProductVariation {
  id: number | string;
  attributes?: Array<{
    name: string;
    value: string;
  }>;
  name?: string;
  options?: string[];
}

export interface ProductAttribute {
  id: number;
  name: string;
  taxonomy: string | null;
  hasVariations: boolean;
  terms: Array<{
    id: number;
    name: string;
    slug: string;
  }>;
}

export interface Product {
  id: number;
  slug: string;
  type?: string;
  name: string;
  permalink: string;
  sku: string;
  shortDescription: string;
  description: string;
  price: number;
  regularPrice?: number;
  salePrice?: number;
  currencyCode: string;
  currencySymbol: string;
  currencyMinorUnit: number;
  image?: ProductImage;
  images: ProductImage[];
  categories: ProductCategory[];
  brands: ProductBrand[];
  available: boolean;
  stockStatus: string;
  averageRating: number;
  reviewCount: number;
  featured: boolean;
  onSale: boolean;
  attributes: ProductAttribute[];
  variations: ProductVariation[];
  hasOptions?: boolean;
  isPurchasable?: boolean;
  commercialText?: string;
  brand?: string;
  pixPrice?: number;
  installmentText?: string;
  stockQuantity?: number;
  specifications?: ProductSpecification[];
}
