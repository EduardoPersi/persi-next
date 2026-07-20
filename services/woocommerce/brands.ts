import type { ProductBrand } from "@/types/brand";
import type { Product } from "@/types/product";
import type { WooCommerceStoreCategory } from "@/types/woocommerce";
import { storeApiGet } from "./client";
import {
  getProducts,
  type GetProductsOptions,
} from "./products";
import {
  isWooCommerceStoreCategory,
  mapStoreCategory,
} from "./mappers";

export interface GetProductBrandsOptions {
  page?: number;
  perPage?: number;
  hideEmpty?: boolean;
}

export async function getProductBrands(
  options: GetProductBrandsOptions = {},
): Promise<ProductBrand[]> {
  const response = await storeApiGet<unknown>("products/brands", {
    query: {
      page: options.page,
      per_page: options.perPage ?? 100,
      hide_empty: options.hideEmpty ?? true,
    },
  });

  if (!Array.isArray(response)) {
    throw new Error("A Store API retornou uma lista de marcas inválida.");
  }

  return response
    .filter(isWooCommerceStoreCategory)
    .map((brand: WooCommerceStoreCategory) => {
      const mappedBrand = mapStoreCategory(brand);

      return {
        id: mappedBrand.id,
        name: mappedBrand.name,
        slug: mappedBrand.slug,
        description: mappedBrand.description,
        count: mappedBrand.count ?? 0,
        image: mappedBrand.image,
        permalink: mappedBrand.permalink,
      };
    });
}

export async function getAllProductBrands(): Promise<ProductBrand[]> {
  const perPage = 100;
  const brands: ProductBrand[] = [];

  for (let page = 1; page <= 20; page += 1) {
    const batch = await getProductBrands({
      page,
      perPage,
      hideEmpty: true,
    });
    brands.push(...batch);

    if (batch.length < perPage) break;
  }

  return brands;
}

export async function getBrandByIdentifier(
  identifier: string,
): Promise<ProductBrand | undefined> {
  const perPage = 100;

  for (let page = 1; page <= 20; page += 1) {
    const brands = await getProductBrands({ page, perPage });
    const brand = brands.find(
      (item) =>
        item.slug === identifier || String(item.id) === identifier,
    );

    if (brand || brands.length < perPage) {
      return brand;
    }
  }

  return undefined;
}

export async function getBrandBySlug(
  slug: string,
): Promise<ProductBrand | undefined> {
  return getBrandByIdentifier(slug);
}

export async function getProductsByBrand(
  brand: string | number,
  options: Omit<GetProductsOptions, "brand"> = {},
): Promise<Product[]> {
  return getProducts({ ...options, brand });
}
