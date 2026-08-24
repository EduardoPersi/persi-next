import "server-only";

import type { Product } from "@/types/product";
import { officialReadWithShadow } from "./shadow";
import { getPostgresProductBySlug } from "./postgres";
import { mapWooProductToCatalog } from "./woocommerce";

export function scheduleProductShadow(product:Product):void {
  void officialReadWithShadow("product_by_slug",product.slug,{official:async()=>mapWooProductToCatalog(product),shadow:()=>getPostgresProductBySlug(product.slug),log:(event)=>console.info("[catalog-shadow]",event)}).catch(()=>undefined);
}
