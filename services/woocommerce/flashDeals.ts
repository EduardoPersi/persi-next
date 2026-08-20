import "server-only";

import { unstable_cache } from "next/cache";
import type { ProductCategory } from "@/types/category";
import type { Product } from "@/types/product";
import type { FlashDealsContext, FlashDealsResult } from "@/types/flash-deals";
import { getAllProductCategories } from "./categories";
import { getProducts } from "./products";

const REVALIDATE_SECONDS = 300;
const SLOT_DURATION_MS = 30 * 60 * 1000;
const CANDIDATE_LIMIT = 48;
const DEALS_LIMIT = 6;
const HOME_FLASH_DEALS_TAG = "ofertas-relampago";

function discountPercentage(product: Product): number {
  if (!product.regularPrice || product.regularPrice <= product.price) return 0;
  return ((product.regularPrice - product.price) / product.regularPrice) * 100;
}

function rankProducts(lists: Product[][]): Product[] {
  const popularityRank = new Map(lists[0].map((product, index) => [product.id, index]));
  const recentRank = new Map(lists[1].map((product, index) => [product.id, index]));
  const unique = new Map(lists.flat().map((product) => [product.id, product]));

  return [...unique.values()]
    .filter((product) => product.onSale && product.available && product.price > 0)
    .sort(
      (first, second) =>
        discountPercentage(second) - discountPercentage(first) ||
        (popularityRank.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
          (popularityRank.get(second.id) ?? Number.MAX_SAFE_INTEGER) ||
        (recentRank.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
          (recentRank.get(second.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

async function loadDeals(query: { category?: number; brand?: number } = {}) {
  const base = {
    ...query,
    perPage: CANDIDATE_LIMIT,
    onSale: true,
    stockStatus: "instock" as const,
    revalidate: REVALIDATE_SECONDS,
  };
  const [popular, recent] = await Promise.all([
    getProducts({ ...base, order: "desc", orderby: "popularity" }),
    getProducts({ ...base, order: "desc", orderby: "date" }),
  ]);
  return rankProducts([popular, recent]);
}

async function loadTaggedHomeDeals() {
  const base = {
    tag: HOME_FLASH_DEALS_TAG,
    perPage: CANDIDATE_LIMIT,
    onSale: true,
    stockStatus: "instock" as const,
    revalidate: REVALIDATE_SECONDS,
  };
  const [popular, recent] = await Promise.all([
    getProducts({ ...base, order: "desc", orderby: "popularity" }),
    getProducts({ ...base, order: "desc", orderby: "date" }),
  ]);
  return rankProducts([popular, recent]);
}

const getCachedHomeDeals = unstable_cache(
  () => loadDeals(),
  ["flash-deals", "home", "v1"],
  { revalidate: REVALIDATE_SECONDS },
);

const getCachedTaggedHomeDeals = unstable_cache(
  loadTaggedHomeDeals,
  ["flash-deals", "home", HOME_FLASH_DEALS_TAG, "v1"],
  { revalidate: REVALIDATE_SECONDS },
);

const getCachedCategoryDeals = unstable_cache(
  (categoryId: number) => loadDeals({ category: categoryId }),
  ["flash-deals", "category", "v1"],
  { revalidate: REVALIDATE_SECONDS },
);

const getCachedBrandDeals = unstable_cache(
  (brandId: number) => loadDeals({ brand: brandId }),
  ["flash-deals", "brand", "v1"],
  { revalidate: REVALIDATE_SECONDS },
);

function relatedCategoryIds(
  categoryId: number,
  categories: ProductCategory[],
): number[] {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return [];
  const parentId = category.parent || category.id;
  const siblings = categories
    .filter((item) => item.parent === parentId && item.id !== categoryId)
    .map((item) => item.id);
  return category.parent ? [category.parent, ...siblings] : siblings;
}

function selectSynchronizedBatch(products: Product[], now: number): FlashDealsResult {
  const slot = Math.floor(now / SLOT_DURATION_MS);
  const batchCount = Math.max(1, Math.ceil(products.length / DEALS_LIMIT));
  const batchIndex = slot % batchCount;
  const offset = batchIndex * DEALS_LIMIT;
  const batch = [...products.slice(offset, offset + DEALS_LIMIT)];
  if (products.length > DEALS_LIMIT && batch.length < DEALS_LIMIT) {
    batch.push(...products.slice(0, DEALS_LIMIT - batch.length));
  }
  return {
    products: batch,
    slot,
    endsAt: new Date((slot + 1) * SLOT_DURATION_MS).toISOString(),
  };
}

export async function getFlashDeals(
  context: FlashDealsContext,
  now = Date.now(),
): Promise<FlashDealsResult> {
  let products: Product[] = [];

  if (context.type === "home") {
    products = await getCachedTaggedHomeDeals().catch(() => []);
    if (products.length === 0) products = await getCachedHomeDeals();
  }
  if (context.type === "category") products = await getCachedCategoryDeals(context.categoryId);
  if (context.type === "brand") products = await getCachedBrandDeals(context.brandId);

  if (context.type === "product") {
    const currentId = context.product.id;
    const primaryCategoryId = context.product.categories[0]?.id;
    if (primaryCategoryId) {
      products = await getCachedCategoryDeals(primaryCategoryId);
      if (products.filter((product) => product.id !== currentId).length < DEALS_LIMIT) {
        const categories = await getAllProductCategories({
          hideEmpty: false,
          revalidate: REVALIDATE_SECONDS,
        });
        for (const categoryId of relatedCategoryIds(primaryCategoryId, categories)) {
          products = rankProducts([products, await getCachedCategoryDeals(categoryId)]);
          if (products.filter((product) => product.id !== currentId).length >= DEALS_LIMIT) break;
        }
      }
    }
    if (products.filter((product) => product.id !== currentId).length < DEALS_LIMIT) {
      products = rankProducts([products, await getCachedHomeDeals()]);
    }
    products = products.filter((product) => product.id !== currentId);
  }

  return selectSynchronizedBatch(products, now);
}

export const FLASH_DEALS_REVALIDATE_SECONDS = REVALIDATE_SECONDS;
