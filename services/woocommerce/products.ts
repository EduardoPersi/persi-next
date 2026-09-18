import { cache } from "react";
import type { Product } from "@/types/product";
import type { WooCommerceStoreProduct } from "@/types/woocommerce";
import {
  storeApiGetWithMeta,
  type StoreApiRequestOptions,
} from "./client";
import {
  convertMajorUnitToMinorUnit,
  isWooCommerceStoreProduct,
  mapStoreProduct,
  mapStoreVariation,
} from "./mappers";
import { getFreeShippingProducts } from "./freeShipping.ts";

export interface GetProductsOptions {
  page?: number;
  perPage?: number;
  search?: string;
  category?: string | number;
  slug?: string;
  include?: readonly number[];
  featured?: boolean;
  minPrice?: number;
  maxPrice?: number;
  currencyMinorUnit?: number;
  stockStatus?:
    | "instock"
    | "outofstock"
    | "onbackorder"
    | readonly ("instock" | "outofstock" | "onbackorder")[];
  onSale?: boolean;
  brand?: string | number;
  tag?: string | number;
  attributes?: Array<{
    taxonomy: string;
    slug: string;
  }>;
  order?: "asc" | "desc";
  revalidate?: number;
  orderby?:
    | "date"
    | "id"
    | "include"
    | "menu_order"
    | "popularity"
    | "price"
    | "rating"
    | "title";
}

export interface ProductsPage {
  products: Product[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export async function getProductsPage(
  options: GetProductsOptions = {},
): Promise<ProductsPage> {
  const currencyMinorUnit = options.currencyMinorUnit ?? 2;
  const query: NonNullable<StoreApiRequestOptions["query"]> = {
      page: options.page,
      per_page: options.perPage,
      search: options.search,
      category: options.category,
      slug: options.slug,
      include: options.include,
      featured: options.featured,
      min_price: convertMajorUnitToMinorUnit(
        options.minPrice,
        currencyMinorUnit,
      ),
      max_price: convertMajorUnitToMinorUnit(
        options.maxPrice,
        currencyMinorUnit,
      ),
      stock_status: options.stockStatus,
      on_sale: options.onSale,
      brand: options.brand,
      tag: options.tag,
      order: options.order,
      orderby: options.orderby,
    };

  options.attributes?.forEach((attribute, index) => {
    query[`attributes[${index}][attribute]`] = attribute.taxonomy;
    query[`attributes[${index}][slug]`] = attribute.slug;
  });

  const [response, freeShippingProducts] = await Promise.all([
    storeApiGetWithMeta<unknown>("products", {
      query,
      revalidate: options.revalidate,
    }),
    getFreeShippingProducts(),
  ]);

  if (!Array.isArray(response.data)) {
    throw new Error("A Store API retornou uma lista de produtos inválida.");
  }

  const products = response.data
    .filter(isWooCommerceStoreProduct)
    .map((product: WooCommerceStoreProduct) => {
      const mapped = mapStoreProduct(product, options.featured ?? false);
      return { ...mapped, freeShipping: freeShippingProducts.ids.has(mapped.id) };
    });

  return {
    products,
    total: response.total,
    totalPages: response.totalPages,
    page: options.page ?? 1,
    perPage: options.perPage ?? products.length,
  };
}

async function getProductsRangeByStockStatus(
  options: GetProductsOptions,
  stockStatus: NonNullable<GetProductsOptions["stockStatus"]>,
  start: number,
  length: number,
): Promise<Product[]> {
  if (length <= 0) return [];

  const perPage = options.perPage ?? 16;
  const firstPage = Math.floor(start / perPage) + 1;
  const lastPage = Math.floor((start + length - 1) / perPage) + 1;
  const pages = await Promise.all(
    Array.from(
      { length: lastPage - firstPage + 1 },
      (_, index) =>
        getProductsPage({
          ...options,
          page: firstPage + index,
          perPage,
          stockStatus,
        }),
    ),
  );

  return pages
    .flatMap((page) => page.products)
    .slice(start % perPage, (start % perPage) + length);
}

export async function getAvailabilityFirstProductsPage(
  options: GetProductsOptions = {},
): Promise<ProductsPage> {
  if (options.stockStatus) {
    return getProductsPage(options);
  }

  const page = Math.max(options.page ?? 1, 1);
  const perPage = options.perPage ?? 16;
  const baseOptions = {
    ...options,
    page: undefined,
    stockStatus: undefined,
  };
  const availableStatuses = ["instock", "onbackorder"] as const;
  const unavailableStatuses = ["outofstock"] as const;
  const [availableMetadata, unavailableMetadata] = await Promise.all([
    getProductsPage({
      ...baseOptions,
      page: 1,
      perPage: 1,
      stockStatus: availableStatuses,
    }),
    getProductsPage({
      ...baseOptions,
      page: 1,
      perPage: 1,
      stockStatus: unavailableStatuses,
    }),
  ]);
  const total = availableMetadata.total + unavailableMetadata.total;
  const offset = (page - 1) * perPage;
  const availableLength = Math.max(
    0,
    Math.min(perPage, availableMetadata.total - offset),
  );
  const unavailableLength = Math.max(
    0,
    Math.min(
      perPage - availableLength,
      total - offset - availableLength,
    ),
  );
  const unavailableStart = Math.max(
    0,
    offset - availableMetadata.total,
  );
  const [availableProducts, unavailableProducts] = await Promise.all([
    getProductsRangeByStockStatus(
      baseOptions,
      availableStatuses,
      offset,
      availableLength,
    ),
    getProductsRangeByStockStatus(
      baseOptions,
      unavailableStatuses,
      unavailableStart,
      unavailableLength,
    ),
  ]);

  return {
    products: [...availableProducts, ...unavailableProducts],
    total,
    totalPages: Math.ceil(total / perPage),
    page,
    perPage,
  };
}

export async function getProducts(
  options: GetProductsOptions = {},
): Promise<Product[]> {
  const response = await getProductsPage(options);

  return response.products;
}

export async function getAllProducts(): Promise<Product[]> {
  const perPage = 50;
  const firstPage = await getProductsPage({
    page: 1,
    perPage,
    revalidate: 86_400,
  });
  const products = [...firstPage.products];
  const pageNumbers = Array.from(
    { length: Math.min(firstPage.totalPages, 100) - 1 },
    (_, index) => index + 2,
  );

  for (let index = 0; index < pageNumbers.length; index += 5) {
    const pages = await Promise.all(
      pageNumbers.slice(index, index + 5).map((page) =>
        getProductsPage({ page, perPage, revalidate: 86_400 }),
      ),
    );
    products.push(...pages.flatMap((page) => page.products));
  }

  return products;
}

export async function getFeaturedProducts(
  perPage = 4,
): Promise<Product[]> {
  return getProducts({
    featured: true,
    perPage,
  });
}

// A3.6-D2-C-R1: wrapped in React's cache() -- generateMetadata and the page
// component (app/_storefront/product-page.tsx), plus the route-type
// resolution that runs ahead of both of them (app/[...segments]/page.tsx's
// resolvePublicRoute), all call this function independently for the SAME
// slug within a single PDP request. cache() is React's own documented
// solution for exactly this "same data needed by metadata and the page"
// scenario (see Next.js's own bundled docs,
// 01-app/01-getting-started/14-metadata-and-og-images.md, "Memoizing data
// requests"): scoped to a single request/render, never cross-request, never
// shared between server instances.
//
// A3.7-A-R14-R2: this function is data retrieval only and must stay that
// way -- it is also called for products that are NOT the route's own PDP
// subject (services/woocommerce/productNavigation.ts's family-navigation
// previous/next lookups use the same function to resolve sibling products).
// A shadow-scheduling side effect used to live here, which meant every
// incidental sibling lookup fired its own [pim-catalog-shadow] telemetry
// event alongside the real one -- found live in A3.7-A-R14-R1 (one PDP
// access produced 3 events for 3 different products). Scheduling now
// happens exactly once, explicitly, at the one call site that actually
// knows a product is the route's main subject (app/_storefront/product-page.tsx).
export const getProductBySlug = cache(async function getProductBySlug(
  slug: string,
): Promise<Product | undefined> {
  const products = await getProducts({
    slug,
    perPage: 1,
  });

  const product = products[0];

  if (!product || product.type !== "variable") return product;

  return {
    ...product,
    variations: await getProductVariations(product.id),
  };
});

export async function getProductVariations(productId: number) {
  const response = await storeApiGetWithMeta<unknown>("products", {
    query: {
      type: "variation",
      parent: productId,
      per_page: 100,
    },
    revalidate: 30,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("A Store API retornou variaÃ§Ãµes invÃ¡lidas.");
  }

  return response.data
    .filter(isWooCommerceStoreProduct)
    .map((variation) => mapStoreVariation(variation, productId));
}

export async function getProductsByCategory(
  category: string | number,
  options: Omit<GetProductsOptions, "category"> = {},
): Promise<Product[]> {
  return getProducts({
    ...options,
    category,
  });
}
