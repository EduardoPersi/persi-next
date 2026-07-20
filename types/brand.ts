import type { ProductImage } from "./product";

export interface ProductBrand {
  id: number;
  name: string;
  slug: string;
  description: string;
  count: number;
  image?: ProductImage;
  permalink?: string;
}
