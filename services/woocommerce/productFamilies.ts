import type { ProductFamilyResponse } from "@/types/productFamily";
import { persiHeadlessGet } from "./persiHeadlessClient";

export function getProductFamily(productId: number) {
  return persiHeadlessGet<ProductFamilyResponse>(
    `products/${productId}/family`,
    60,
  );
}
