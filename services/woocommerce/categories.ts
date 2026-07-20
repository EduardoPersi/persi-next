import type { ProductCategory } from "@/types/category";
import type { WooCommerceStoreCategory } from "@/types/woocommerce";
import { storeApiGet } from "./client";
import {
  isWooCommerceStoreCategory,
  mapStoreCategory,
} from "./mappers";

export interface GetProductCategoriesOptions {
  page?: number;
  perPage?: number;
  hideEmpty?: boolean;
}

export async function getProductCategories(
  options: GetProductCategoriesOptions = {},
): Promise<ProductCategory[]> {
  const response = await storeApiGet<unknown>("products/categories", {
    query: {
      page: options.page,
      per_page: options.perPage,
      hide_empty: options.hideEmpty ?? true,
    },
  });

  if (!Array.isArray(response)) {
    throw new Error(
      "A Store API retornou uma lista de categorias inválida.",
    );
  }

  return response
    .filter(isWooCommerceStoreCategory)
    .map((category: WooCommerceStoreCategory) =>
      mapStoreCategory(category),
    );
}

export async function getCategoryBySlug(
  slug: string,
): Promise<ProductCategory | undefined> {
  const perPage = 100;
  let page = 1;

  while (page <= 20) {
    const categories = await getProductCategories({
      page,
      perPage,
    });
    const category = categories.find((item) => item.slug === slug);

    if (category || categories.length < perPage) {
      return category;
    }

    page += 1;
  }

  return undefined;
}

export async function getAllProductCategories(): Promise<
  ProductCategory[]
> {
  const perPage = 100;
  const categories: ProductCategory[] = [];
  let page = 1;

  while (page <= 20) {
    const batch = await getProductCategories({
      page,
      perPage,
    });

    categories.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return categories;
}
