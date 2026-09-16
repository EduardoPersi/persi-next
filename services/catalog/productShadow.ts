import "server-only";

import type { Product } from "@/types/product";
import { officialReadWithShadow } from "./shadow";
import { getPostgresProductBySlug } from "./postgres";
import { mapWooProductToCatalog } from "./woocommerce";
import { runPimCatalogShadow } from "@/lib/pim/publication-shadow-runtime";

export function scheduleProductShadow(product:Product):void {
  // mapWooProductToCatalog is called lazily inside a try/catch, never
  // eagerly at the top of this function: a synchronous throw here (e.g. a
  // malformed product) must never escape scheduleProductShadow, since its
  // caller (getProductBySlug) invokes it unguarded. Both shadows share the
  // SAME computed value via a memoized getter, so mapping still only runs
  // once per call when both consume it, without letting a mapping failure
  // become an uncaught exception on the official request path.
  let official: ReturnType<typeof mapWooProductToCatalog> | undefined;
  const getOfficial = () => (official ??= mapWooProductToCatalog(product));

  void officialReadWithShadow("product_by_slug",product.slug,{official:async()=>getOfficial(),shadow:()=>getPostgresProductBySlug(product.slug),log:(event)=>console.info("[catalog-shadow]",event)}).catch(()=>undefined);

  // A3.6-B: a SEPARATE, PIM-specific shadow observation (see
  // lib/pim/publication-shadow-runtime.ts) -- deliberately not merged with
  // the whole-catalog Woo-vs-Postgres comparison above. Independent,
  // fire-and-forget, cannot influence the return value of getProductBySlug.
  // Runs as a true no-op today: PIM_PUBLICATION_MODE defaults to "off" in
  // every environment, checked before any database access.
  try {
    runPimCatalogShadow(getOfficial(), "product");
  } catch {
    // Fail-open for official (Section 9): a mapping/scheduling failure
    // here must never propagate to the caller.
  }
}
