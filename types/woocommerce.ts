export interface WooCommerceStorePrices {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code: string;
  currency_symbol: string;
  currency_minor_unit: number;
}

export interface WooCommerceStoreImage {
  id: number;
  src: string;
  thumbnail: string;
  srcset?: string;
  sizes?: string;
  name: string;
  alt: string;
}

export interface WooCommerceStoreCategoryReference {
  id: number;
  name: string;
  slug: string;
  link: string;
}

export interface WooCommerceStoreBrand {
  id: number;
  name: string;
  slug: string;
  link?: string;
}

export interface WooCommerceStoreAttribute {
  id: number;
  name: string;
  taxonomy: string | null;
  has_variations: boolean;
  terms: Array<{
    id: number;
    name: string;
    slug: string;
  }>;
}

export interface WooCommerceStoreVariation {
  id: number;
  attributes?: Array<{
    name: string;
    value: string;
  }>;
}

export interface WooCommerceStoreProduct {
  id: number;
  name: string;
  slug: string;
  type: string;
  permalink: string;
  sku: string;
  short_description: string;
  description: string;
  on_sale: boolean;
  prices: WooCommerceStorePrices;
  price_html: string;
  average_rating: string;
  review_count: number;
  images: WooCommerceStoreImage[];
  categories: WooCommerceStoreCategoryReference[];
  brands?: WooCommerceStoreBrand[];
  attributes: WooCommerceStoreAttribute[];
  variations: WooCommerceStoreVariation[];
  has_options: boolean;
  is_purchasable: boolean;
  is_in_stock: boolean;
  stock_availability?: {
    text?: string;
    class?: string;
  };
}

export interface WooCommerceStoreCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent: number;
  count: number;
  image: WooCommerceStoreImage | null;
  permalink?: string;
}
