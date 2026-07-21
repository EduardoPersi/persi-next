export interface WooCommerceRestImage {
  id: number;
  src: string;
  name: string;
  alt: string;
}

export interface WooCommerceRestTerm {
  id: number;
  name: string;
  slug: string;
}

export interface WooCommerceRestAttribute {
  id: number;
  name: string;
  slug?: string;
  variation: boolean;
  options: string[];
}

export interface WooCommerceRestProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  type: string;
  status: string;
  date_created?: string;
  sku: string;
  global_unique_id?: string;
  description: string;
  short_description: string;
  price: string;
  regular_price: string;
  sale_price: string;
  price_html: string;
  on_sale: boolean;
  purchasable: boolean;
  stock_status: "instock" | "outofstock" | "onbackorder";
  average_rating: string;
  rating_count: number;
  total_sales?: number;
  images: WooCommerceRestImage[];
  categories: WooCommerceRestTerm[];
  brands?: WooCommerceRestTerm[];
  attributes: WooCommerceRestAttribute[];
  variations: number[];
}
