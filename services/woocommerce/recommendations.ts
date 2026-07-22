import "server-only";

import { unstable_cache } from "next/cache";
import type { ProductCategory } from "@/types/category";
import type { Product } from "@/types/product";
import type { WooCommerceRestProduct } from "@/types/woocommerce-rest";
import { getAllProductCategories } from "./categories";
import { restApiGetWithMeta } from "./restClient";
import { mapRestProduct } from "./search";

const MAX_COMPLEMENTARY_PRODUCTS = 2;

function isRestProduct(value: unknown): value is WooCommerceRestProduct {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<WooCommerceRestProduct>;
  return (
    typeof product.id === "number" &&
    typeof product.name === "string" &&
    typeof product.slug === "string" &&
    Array.isArray(product.images) &&
    Array.isArray(product.categories) &&
    Array.isArray(product.attributes)
  );
}

async function getRestProducts(
  query: Record<string, string | number | boolean | undefined>,
) {
  const response = await restApiGetWithMeta<unknown>("products", {
    query: { status: "publish", per_page: 100, ...query },
  });
  return Array.isArray(response.data)
    ? response.data.filter(isRestProduct)
    : [];
}

function getCategoryDepth(
  category: ProductCategory,
  categories: ProductCategory[],
) {
  let depth = 0;
  let parentId = category.parent;
  const visited = new Set([category.id]);

  while (parentId > 0 && !visited.has(parentId)) {
    const parent = categories.find((item) => item.id === parentId);
    if (!parent) break;
    visited.add(parent.id);
    parentId = parent.parent;
    depth += 1;
  }

  return depth;
}

function isValidComplement(product: WooCommerceRestProduct) {
  return (
    product.type === "simple" &&
    product.status === "publish" &&
    product.catalog_visibility !== "hidden" &&
    product.purchasable &&
    product.stock_status !== "outofstock" &&
    Number(product.price) > 0
  );
}

function getSharedAttributeScore(
  current: WooCommerceRestProduct,
  candidate: WooCommerceRestProduct,
) {
  let score = 0;
  const candidateAttributes = new Map(
    candidate.attributes.map((attribute) => [
      attribute.slug || attribute.name,
      new Set(attribute.options.map((option) => option.toLocaleLowerCase("pt-BR"))),
    ]),
  );

  current.attributes.forEach((attribute) => {
    const candidateOptions = candidateAttributes.get(
      attribute.slug || attribute.name,
    );
    if (!candidateOptions) return;
    const hasCompatibleOption = attribute.options.some((option) =>
      candidateOptions.has(option.toLocaleLowerCase("pt-BR")),
    );
    score += hasCompatibleOption ? 15 : -40;
  });

  return Math.max(score, -80);
}

function scoreCandidate(
  current: WooCommerceRestProduct,
  candidate: WooCommerceRestProduct,
  specificCategoryId: number | undefined,
) {
  let score = 0;
  const candidateCategoryIds = new Set(candidate.categories.map((item) => item.id));
  const currentBrandIds = new Set((current.brands ?? []).map((item) => item.id));
  const currentTagIds = new Set((current.tags ?? []).map((item) => item.id));

  if (specificCategoryId && candidateCategoryIds.has(specificCategoryId)) score += 50;
  if ((candidate.brands ?? []).some((brand) => currentBrandIds.has(brand.id))) {
    score += 25;
  }
  score += getSharedAttributeScore(current, candidate);
  if ((candidate.tags ?? []).some((tag) => currentTagIds.has(tag.id))) score += 10;

  const currentPrice = Number(current.price);
  const candidatePrice = Number(candidate.price);
  if (
    currentPrice > 0 &&
    candidatePrice >= currentPrice * 0.05 &&
    candidatePrice <= currentPrice * 1.5
  ) {
    score += 5;
  }
  if ((current.related_ids ?? []).includes(candidate.id)) score += 20;

  return score;
}

async function getBuyTogetherProductsUncached(slug: string): Promise<Product[]> {
  const [currentProduct] = await getRestProducts({ slug });
  if (!currentProduct) return [];

  const manualIds = [
    ...(currentProduct.upsell_ids ?? []),
    ...(currentProduct.cross_sell_ids ?? []),
  ].filter((id, index, ids) => id !== currentProduct.id && ids.indexOf(id) === index);
  const manualProducts = manualIds.length
    ? await getRestProducts({ include: manualIds.join(","), orderby: "include" })
    : [];
  const manualById = new Map(manualProducts.map((product) => [product.id, product]));
  const selected = manualIds
    .map((id) => manualById.get(id))
    .filter((product): product is WooCommerceRestProduct =>
      Boolean(product && isValidComplement(product)),
    );

  if (selected.length < MAX_COMPLEMENTARY_PRODUCTS) {
    const categories = await getAllProductCategories();
    const assignedCategories = currentProduct.categories
      .map((term) => categories.find((category) => category.id === term.id))
      .filter((category): category is ProductCategory => Boolean(category));
    const specificCategory = assignedCategories.sort(
      (first, second) =>
        getCategoryDepth(second, categories) - getCategoryDepth(first, categories),
    )[0];
    const candidateQueries: Promise<WooCommerceRestProduct[]>[] = [];

    if (specificCategory) {
      candidateQueries.push(getRestProducts({ category: specificCategory.id }));
    }
    if ((currentProduct.related_ids ?? []).length > 0) {
      candidateQueries.push(
        getRestProducts({
          include: (currentProduct.related_ids ?? []).join(","),
        }),
      );
    }

    const excludedIds = new Set([currentProduct.id, ...selected.map((item) => item.id)]);
    const candidates = [...new Map(
      (await Promise.all(candidateQueries))
        .flat()
        .filter((product) => !excludedIds.has(product.id) && isValidComplement(product))
        .map((product) => [product.id, product]),
    ).values()]
      .map((product) => ({
        product,
        score: scoreCandidate(currentProduct, product, specificCategory?.id),
      }))
      .filter((item) => item.score >= 35)
      .sort(
        (first, second) =>
          second.score - first.score || first.product.id - second.product.id,
      );

    selected.push(
      ...candidates
        .slice(0, MAX_COMPLEMENTARY_PRODUCTS - selected.length)
        .map((item) => item.product),
    );
  }

  return selected.slice(0, MAX_COMPLEMENTARY_PRODUCTS).map(mapRestProduct);
}

export const getBuyTogetherProducts = unstable_cache(
  getBuyTogetherProductsUncached,
  ["buy-together-products"],
  { revalidate: 120 },
);
