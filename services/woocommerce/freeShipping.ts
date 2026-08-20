import "server-only";
import { unstable_cache } from "next/cache.js";
import { restApiGetWithMeta } from "./restClient.ts";

const CLASS_SLUG = "frete-gratis";
const CACHE_SECONDS = 300;

interface ApiReference { id?: unknown; slug?: unknown }
export interface FreeShippingProducts {
  ids: ReadonlySet<number>;
  slugs: ReadonlySet<string>;
}

const loadProducts = unstable_cache(async () => {
  const classes = await restApiGetWithMeta<unknown>("products/shipping_classes", {
    query: { per_page: 100 },
    revalidate: CACHE_SECONDS,
  });
  const shippingClass = Array.isArray(classes.data)
    ? (classes.data as ApiReference[]).find((item) => item.slug === CLASS_SLUG)
    : undefined;
  if (typeof shippingClass?.id !== "number") return [];

  const products = await restApiGetWithMeta<unknown>("products", {
    query: { shipping_class: shippingClass.id, status: "publish", per_page: 100 },
    revalidate: CACHE_SECONDS,
  });
  return Array.isArray(products.data)
    ? (products.data as ApiReference[]).flatMap((product) =>
        typeof product.id === "number" && typeof product.slug === "string"
          ? [{ id: product.id, slug: product.slug }]
          : [],
      )
    : [];
}, ["woocommerce-free-shipping-products-v1"], { revalidate: CACHE_SECONDS });

export async function getFreeShippingProducts(): Promise<FreeShippingProducts> {
  try {
    const products = await loadProducts();
    return {
      ids: new Set(products.map(({ id }) => id)),
      slugs: new Set(products.map(({ slug }) => slug)),
    };
  } catch (error) {
    console.error("[woocommerce-free-shipping]", {
      message: error instanceof Error ? error.message : "Falha desconhecida.",
    });
    return { ids: new Set(), slugs: new Set() };
  }
}
