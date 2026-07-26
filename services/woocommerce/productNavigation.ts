import "server-only";

import { getCircularAdjacentItems } from "@/lib/commerce/adjacentProducts";
import {
  getCategoryHref,
  resolveProductCategoryPath,
} from "@/lib/seo/productBreadcrumb";
import type { ProductCategory } from "@/types/category";
import type { Product } from "@/types/product";
import type { ProductFamilyResponse } from "@/types/productFamily";
import type {
  AdjacentProductSummary,
  ProductNavigationData,
} from "@/types/productNavigation";
import { getProductBySlug, getProductsByCategory } from "./products";

const MAX_CATEGORY_PRODUCTS = 100;

export function getProductHref(slug: string): string {
  return `/produto/${encodeURIComponent(slug)}`;
}

function formatPrice(product: Product): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: product.currencyCode,
  }).format(product.price);
}

function mapProductSummary(product: Product): AdjacentProductSummary {
  const image = product.image ?? product.images[0];

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    href: getProductHref(product.slug),
    image: image
      ? {
          src: image.thumbnail || image.src,
          alt: image.alt || product.name,
        }
      : null,
    formattedPrice: formatPrice(product),
    inStock: product.available,
  };
}

function getNumericAttributeValue(
  family: ProductFamilyResponse,
  productId: number,
): number | undefined {
  const taxonomy = family.family.attributes[0]?.taxonomy;
  const label = taxonomy
    ? family.items.find((item) => item.productId === productId)?.attributes[
        taxonomy
      ]?.label
    : undefined;
  if (!label) return undefined;

  const match = label.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;

  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

async function getFamilyNavigation(
  product: Product,
  family: ProductFamilyResponse,
): Promise<Pick<ProductNavigationData, "previous" | "next"> | undefined> {
  const validItems = family.items.filter(
    (item) => item.slug && item.productId > 0,
  );
  const hasNumericAttribute = validItems.every(
    (item) => getNumericAttributeValue(family, item.productId) !== undefined,
  );
  const orderedItems = hasNumericAttribute
    ? [...validItems].sort(
        (first, second) =>
          (getNumericAttributeValue(family, first.productId) ?? 0) -
            (getNumericAttributeValue(family, second.productId) ?? 0) ||
          first.productId - second.productId,
      )
    : validItems;
  const adjacent = getCircularAdjacentItems(
    orderedItems.map((item) => ({ ...item, id: item.productId })),
    product.id,
  );
  if (!adjacent) return undefined;

  const [previousProduct, nextProduct] = await Promise.all([
    getProductBySlug(adjacent.previous.slug),
    adjacent.next.productId === adjacent.previous.productId
      ? Promise.resolve(undefined)
      : getProductBySlug(adjacent.next.slug),
  ]);
  if (!previousProduct) return undefined;

  const previous = mapProductSummary(previousProduct);
  const next = nextProduct ? mapProductSummary(nextProduct) : previous;

  return { previous, next };
}

async function getCategoryNavigation(
  product: Product,
  category: Pick<ProductCategory, "id">,
): Promise<Pick<ProductNavigationData, "previous" | "next"> | undefined> {
  const products = await getProductsByCategory(category.id, {
    perPage: MAX_CATEGORY_PRODUCTS,
    order: "asc",
    orderby: "menu_order",
  });
  const adjacent = getCircularAdjacentItems(products, product.id);
  if (!adjacent) return undefined;

  return {
    previous: mapProductSummary(adjacent.previous),
    next: mapProductSummary(adjacent.next),
  };
}

interface GetProductNavigationOptions {
  product: Product;
  categories: ProductCategory[];
  family?: ProductFamilyResponse;
}

export async function getProductNavigation({
  product,
  categories,
  family,
}: GetProductNavigationOptions): Promise<ProductNavigationData | undefined> {
  const categoryPath = resolveProductCategoryPath({
    productCategoryIds: product.categories.map((category) => category.id),
    categories,
  });
  const primaryCategory = categoryPath.at(-1);
  const category = primaryCategory
    ? {
        id: primaryCategory.id,
        name: primaryCategory.name,
        slug: primaryCategory.slug,
        href: getCategoryHref(primaryCategory.slug),
      }
    : null;

  if (family) {
    const familyNavigation = await getFamilyNavigation(product, family);
    if (familyNavigation) {
      return {
        ...familyNavigation,
        category,
        source: "family",
      };
    }
  }

  if (!primaryCategory) return undefined;

  const categoryNavigation = await getCategoryNavigation(
    product,
    primaryCategory,
  );
  if (!categoryNavigation) return undefined;

  return {
    ...categoryNavigation,
    category,
    source: "category",
  };
}
