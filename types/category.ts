import type { ProductImage } from "./product";

export interface ProductCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  parent: number;
  count?: number;
  image?: ProductImage;
  permalink?: string;
}
