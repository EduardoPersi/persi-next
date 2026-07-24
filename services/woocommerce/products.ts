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

export interface GetProductsOptions {
  page?: number;
  perPage?: number;
  search?: string;
  category?: string | number;
  slug?: string;
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
  attributes?: Array<{
    taxonomy: string;
    slug: string;
  }>;
  order?: "asc" | "desc";
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
      order: options.order,
      orderby: options.orderby,
    };

  options.attributes?.forEach((attribute, index) => {
    query[`attributes[${index}][attribute]`] = attribute.taxonomy;
    query[`attributes[${index}][slug]`] = attribute.slug;
  });

  const response = await storeApiGetWithMeta<unknown>("products", {
    query,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("A Store API retornou uma lista de produtos inválida.");
  }

  const products = response.data
    .filter(isWooCommerceStoreProduct)
    .map((product: WooCommerceStoreProduct) =>
      mapStoreProduct(product, options.featured ?? false),
    );

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

export async function getFeaturedProducts(
  perPage = 4,
): Promise<Product[]> {
  return getProducts({
    featured: true,
    perPage,
  });
}

export async function getProductBySlug(
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
}

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
