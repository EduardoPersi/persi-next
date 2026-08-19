import type { Product } from "./product";

export type FlashDealsContext =
  | { type: "home" }
  | { type: "product"; product: Product }
  | { type: "category"; categoryId: number }
  | { type: "brand"; brandId: number };

export interface FlashDealsResult {
  products: Product[];
  slot: number;
  endsAt: string;
}
