import "server-only";

import { PRODUCT_SEARCH_SYNONYM_GROUPS } from "@/lib/constants/searchSynonyms";
import type {
  CatalogAttributeFilter,
  CatalogFilterData,
  CatalogFilterOption,
} from "@/types/catalog-filters";
import type { Product, ProductAttribute } from "@/types/product";
import type {
  WooCommerceRestProduct,
  WooCommerceRestTerm,
} from "@/types/woocommerce-rest";
import { stripHtml } from "./mappers";
import { getAllProductBrands } from "./brands";
import { restApiGetWithMeta } from "./restClient";

const REST_PAGE_SIZE = 100;
const MAX_RESULT_PAGES_PER_QUERY = 5;

export interface ProductSearchFilters {
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  onSaleOnly?: boolean;
  brands?: string[];
  categories?: string[];
  attributes?: Record<string, string[]>;
}

export type ProductSearchOrder =
  | "relevancia"
  | "recentes"
  | "menor-preco"
  | "maior-preco"
  | "mais-vendidos"
  | "nome-az";

interface SearchProductsOptions {
  filters?: ProductSearchFilters;
  order?: ProductSearchOrder;
  limit?: number;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "-");
}

function getStableNumber(value: string) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function getCanonicalBrandKey(name: string, slug?: string) {
  return slugify(slug || name);
}

function getCanonicalBrandId(name: string, slug?: string) {
  return getStableNumber(`brand-${getCanonicalBrandKey(name, slug)}`) || 1;
}

function isBrandAttribute(attribute: WooCommerceRestProduct["attributes"][number]) {
  return (
    attribute.slug === "pa_marca" ||
    normalizeSearchText(attribute.name) === "marca"
  );
}

export function expandProductSearchTerms(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const terms = new Set([query.trim()]);

  PRODUCT_SEARCH_SYNONYM_GROUPS.forEach((group) => {
    const normalizedGroup = group.map(normalizeSearchText);
    normalizedGroup.forEach((alias) => {
      if (!normalizedQuery.includes(alias)) return;

      normalizedGroup.forEach((replacement) => {
        terms.add(normalizedQuery.replace(alias, replacement));
      });
    });
  });

  return [...terms].filter(Boolean);
}

function isRestProduct(value: unknown): value is WooCommerceRestProduct {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<WooCommerceRestProduct>;
  return (
    typeof product.id === "number" &&
    typeof product.name === "string" &&
    typeof product.slug === "string" &&
    Array.isArray(product.images) &&
    Array.isArray(product.categories)
  );
}

function isRestTerm(value: unknown): value is WooCommerceRestTerm {
  if (!value || typeof value !== "object") return false;
  const term = value as Partial<WooCommerceRestTerm>;
  return (
    typeof term.id === "number" &&
    typeof term.name === "string" &&
    typeof term.slug === "string"
  );
}

function mapAttributes(
  productId: number,
  attributes: WooCommerceRestProduct["attributes"] = [],
): ProductAttribute[] {
  return attributes.filter((attribute) => !isBrandAttribute(attribute)).map((attribute, attributeIndex) => {
    const taxonomy =
      attribute.slug ||
      (attribute.id > 0 ? `pa_${slugify(attribute.name)}` : null);
    const attributeId = attribute.id || getStableNumber(attribute.name);

    return {
      id: attributeId,
      name: stripHtml(attribute.name),
      taxonomy,
      hasVariations: attribute.variation,
      terms: attribute.options.map((option, optionIndex) => ({
        id: getStableNumber(
          `${productId}-${attributeId}-${option}-${attributeIndex}-${optionIndex}`,
        ),
        name: stripHtml(option),
        slug: slugify(option),
      })),
    };
  });
}

function parsePrice(value: string | undefined) {
  const price = Number.parseFloat(value ?? "");
  return Number.isFinite(price) ? price : undefined;
}

export function mapRestProduct(product: WooCommerceRestProduct): Product {
  const name = stripHtml(product.name);
  const description = stripHtml(product.description ?? "");
  const images = (product.images ?? []).map((image) => ({
    id: image.id,
    src: image.src,
    name: stripHtml(image.name),
    alt: stripHtml(image.alt) || name,
  }));
  const price = parsePrice(product.price) ?? 0;
  const regularPrice = parsePrice(product.regular_price);
  const salePrice = parsePrice(product.sale_price);
  const available =
    product.purchasable && product.stock_status !== "outofstock";
  const taxonomyBrands = product.brands ?? [];
  const fallbackBrandNames = (product.attributes ?? [])
    .filter(isBrandAttribute)
    .flatMap((attribute) => attribute.options);
  const canonicalBrands =
    taxonomyBrands.length > 0
      ? taxonomyBrands.map((brand) => ({
          id: brand.id,
          name: stripHtml(brand.name),
          slug: getCanonicalBrandKey(brand.name, brand.slug),
        }))
      : fallbackBrandNames.map((brandName) => ({
          id: getCanonicalBrandId(brandName),
          name: stripHtml(brandName),
          slug: getCanonicalBrandKey(brandName),
        }));

  return {
    id: product.id,
    slug: product.slug,
    type: product.type,
    name,
    dateCreated: product.date_created,
    totalSales: product.total_sales ?? 0,
    permalink: product.permalink,
    sku: product.sku ?? "",
    ean: product.global_unique_id?.trim() || null,
    shortDescription:
      stripHtml(product.short_description ?? "") || description.slice(0, 240),
    description,
    price,
    regularPrice,
    salePrice,
    currencyCode: "BRL",
    currencySymbol: "R$",
    currencyMinorUnit: 2,
    image: images[0],
    images,
    categories: (product.categories ?? []).map((category) => ({
      id: category.id,
      name: stripHtml(category.name),
      slug: category.slug,
      description: "",
      parent: 0,
    })),
    brands: [...new Map(
      canonicalBrands.map((brand) => [brand.slug, brand]),
    ).values()],
    available,
    stockStatus: product.stock_status,
    averageRating: Number.parseFloat(product.average_rating) || 0,
    reviewCount: product.rating_count ?? 0,
    featured: false,
    onSale: product.on_sale,
    attributes: mapAttributes(product.id, product.attributes),
    variations: (product.variations ?? []).map((id) => ({ id })),
    hasOptions:
      product.type === "variable" || (product.variations?.length ?? 0) > 0,
    isPurchasable: product.purchasable,
    commercialText: stripHtml(product.price_html ?? ""),
  };
}

async function getAllRestProducts(
  query: Record<string, string | number | boolean | undefined>,
  limit?: number,
  maxPages = MAX_RESULT_PAGES_PER_QUERY,
) {
  const firstResponse = await restApiGetWithMeta<unknown>("products", {
    query: {
      status: "publish",
      per_page: Math.min(limit ?? REST_PAGE_SIZE, REST_PAGE_SIZE),
      page: 1,
      ...query,
    },
  });
  const products = Array.isArray(firstResponse.data)
    ? firstResponse.data.filter(isRestProduct)
    : [];
  const wantedPages = limit
    ? 1
    : Math.min(firstResponse.totalPages, maxPages);

  if (wantedPages > 1) {
    const remainingResponses = await Promise.all(
      Array.from({ length: wantedPages - 1 }, (_, index) =>
        restApiGetWithMeta<unknown>("products", {
          query: {
            status: "publish",
            per_page: REST_PAGE_SIZE,
            page: index + 2,
            ...query,
          },
        }),
      ),
    );
    remainingResponses.forEach((response) => {
      if (Array.isArray(response.data)) {
        products.push(...response.data.filter(isRestProduct));
      }
    });
  }

  return products.slice(0, limit);
}

export interface CatalogFilterContext {
  brand?: string | number;
  onSale?: boolean;
}

export async function getFilterContextProducts(
  context: CatalogFilterContext,
): Promise<Product[]> {
  const products = await getAllRestProducts(
    {
      brand: context.brand,
      on_sale: context.onSale,
    },
    undefined,
    Number.MAX_SAFE_INTEGER,
  );
  return products.map(mapRestProduct);
}

async function findTerms(endpoint: string, terms: string[]) {
  const responses = await Promise.allSettled(
    terms.map((term) =>
      restApiGetWithMeta<unknown>(endpoint, {
        query: { search: term, per_page: 20 },
      }),
    ),
  );

  return responses.flatMap((response) =>
    response.status === "fulfilled" && Array.isArray(response.value.data)
      ? response.value.data.filter(isRestTerm)
      : [],
  );
}

function getRelevance(product: Product, query: string, terms: string[]) {
  const normalizedQuery = normalizeSearchText(query);
  const name = normalizeSearchText(product.name);
  const sku = normalizeSearchText(product.sku);
  const ean = normalizeSearchText(product.ean ?? "");
  let score = 0;

  if (sku === normalizedQuery || ean === normalizedQuery) score += 1000;
  if (name === normalizedQuery) score += 500;
  if (name.startsWith(normalizedQuery)) score += 300;
  if (name.includes(normalizedQuery)) score += 200;
  if (
    product.brands.some((brand) =>
      normalizeSearchText(brand.name).includes(normalizedQuery),
    )
  ) score += 100;
  if (
    product.categories.some((category) =>
      normalizeSearchText(category.name).includes(normalizedQuery),
    )
  ) score += 80;

  const searchableText = normalizeSearchText(
    [product.name, product.shortDescription, product.description].join(" "),
  );
  terms.forEach((term) => {
    if (searchableText.includes(normalizeSearchText(term))) score += 20;
  });

  return score;
}

function applyFilters(products: Product[], filters?: ProductSearchFilters) {
  if (!filters) return products;
  const selectedBrands = new Set(filters.brands ?? []);
  const selectedCategories = new Set(filters.categories ?? []);

  return products.filter((product) => {
    if (filters.minPrice !== undefined && product.price < filters.minPrice) {
      return false;
    }
    if (filters.maxPrice !== undefined && product.price > filters.maxPrice) {
      return false;
    }
    if (filters.inStockOnly && !product.available) return false;
    if (filters.onSaleOnly && !product.onSale) return false;
    if (
      selectedBrands.size > 0 &&
      !product.brands.some(
        (brand) =>
          selectedBrands.has(String(brand.id)) ||
          selectedBrands.has(brand.slug),
      )
    ) return false;
    if (
      selectedCategories.size > 0 &&
      !product.categories.some(
        (category) =>
          selectedCategories.has(String(category.id)) ||
          selectedCategories.has(category.slug),
      )
    ) return false;

    return Object.entries(filters.attributes ?? {}).every(
      ([taxonomy, selectedValues]) => {
        const selected = new Set(selectedValues);
        return product.attributes.some(
          (attribute) =>
            attribute.taxonomy === taxonomy &&
            attribute.terms.some((term) => selected.has(term.slug)),
        );
      },
    );
  });
}

function sortProducts(
  products: Product[],
  query: string,
  terms: string[],
  order: ProductSearchOrder = "relevancia",
) {
  return [...products].sort((first, second) => {
    if (first.available !== second.available) return first.available ? -1 : 1;
    if (order === "menor-preco") return first.price - second.price;
    if (order === "maior-preco") return second.price - first.price;
    if (order === "nome-az") {
      return first.name.localeCompare(second.name, "pt-BR");
    }
    if (order === "mais-vendidos") {
      return (second.totalSales ?? 0) - (first.totalSales ?? 0);
    }
    if (order === "recentes") {
      return (
        Date.parse(second.dateCreated ?? "") -
        Date.parse(first.dateCreated ?? "")
      );
    }
    return (
      getRelevance(second, query, terms) - getRelevance(first, query, terms)
    );
  });
}

export function filterAndSortSearchProducts(
  products: Product[],
  query: string,
  filters?: ProductSearchFilters,
  order?: ProductSearchOrder,
) {
  return sortProducts(
    applyFilters(products, filters),
    query,
    expandProductSearchTerms(query),
    order,
  );
}

export async function searchWooCommerceProducts(
  query: string,
  options: SearchProductsOptions = {},
) {
  const trimmedQuery = query.trim().slice(0, 100);
  if (!trimmedQuery) return [];
  const terms = expandProductSearchTerms(trimmedQuery);
  const [categories, brands] = await Promise.all([
    findTerms("products/categories", terms),
    findTerms("products/brands", terms),
  ]);
  const productQueries: Array<
    Record<string, string | number | boolean | undefined>
  > = [
    ...terms.map((term) => ({ search: term })),
    { sku: trimmedQuery },
    { global_unique_id: trimmedQuery },
    ...categories.map((category) => ({ category: category.id })),
    ...brands.map((brand) => ({ brand: brand.id })),
  ];
  const responses = await Promise.allSettled(
    productQueries.map((productQuery) =>
      getAllRestProducts(productQuery, options.limit),
    ),
  );
  const productsById = new Map<number, Product>();

  responses.forEach((response) => {
    if (response.status !== "fulfilled") return;
    response.value.forEach((product) => {
      productsById.set(product.id, mapRestProduct(product));
    });
  });

  if (productsById.size === 0 && responses.every((item) => item.status === "rejected")) {
    throw new Error("Não foi possível pesquisar produtos no WooCommerce.");
  }

  return sortProducts(
    applyFilters([...productsById.values()], options.filters),
    trimmedQuery,
    terms,
    options.order,
  ).slice(0, options.limit);
}

export async function getSearchFilterData(products: Product[]): Promise<CatalogFilterData> {
  const prices = products.map((product) => product.price).filter(Number.isFinite);
  const brandMap = new Map<string, CatalogFilterOption>();
  const categoryMap = new Map<number, CatalogFilterOption>();
  const attributeMap = new Map<
    string,
    CatalogAttributeFilter & { optionCounts: Map<string, CatalogFilterOption> }
  >();

  const officialBrands = await getAllProductBrands().catch(() => []);
  const officialBrandsByKey = new Map(
    officialBrands.map((brand) => [
      getCanonicalBrandKey(brand.name, brand.slug),
      brand,
    ]),
  );

  products.forEach((product) => {
    product.brands.forEach((brand) => {
      const key = getCanonicalBrandKey(brand.name, brand.slug);
      const current = brandMap.get(key);
      const officialBrand = officialBrandsByKey.get(key);
      const image = officialBrand?.image;
      brandMap.set(key, {
        id: officialBrand?.id ?? brand.id,
        name: officialBrand?.name ?? brand.name,
        slug: officialBrand?.slug ?? key,
        count: (current?.count ?? 0) + 1,
        image: image
          ? { src: image.src, alt: image.alt || `Logo ${brand.name}` }
          : undefined,
      });
    });
    product.categories.forEach((category) => {
      const current = categoryMap.get(category.id);
      categoryMap.set(category.id, {
        id: category.id,
        name: category.name,
        slug: category.slug,
        count: (current?.count ?? 0) + 1,
      });
    });
    product.attributes.forEach((attribute) => {
      if (!attribute.taxonomy) return;
      const current = attributeMap.get(attribute.taxonomy) ?? {
        id: attribute.id,
        name: attribute.name,
        taxonomy: attribute.taxonomy,
        options: [],
        optionCounts: new Map<string, CatalogFilterOption>(),
      };
      attribute.terms.forEach((term) => {
        const option = current.optionCounts.get(term.slug);
        current.optionCounts.set(term.slug, {
          id: term.id,
          name: term.name,
          slug: term.slug,
          count: (option?.count ?? 0) + 1,
        });
      });
      attributeMap.set(attribute.taxonomy, current);
    });
  });

  return {
    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
    inStockCount: products.filter((product) => product.available).length,
    onSaleAvailable: products.some((product) => product.onSale),
    brands: [...brandMap.values()].sort((first, second) =>
      first.name.localeCompare(second.name, "pt-BR"),
    ),
    categories: [...categoryMap.values()].sort((first, second) =>
      first.name.localeCompare(second.name, "pt-BR"),
    ),
    attributes: [...attributeMap.values()].map(({ optionCounts, ...attribute }) => ({
      ...attribute,
      options: [...optionCounts.values()].sort((first, second) =>
        first.name.localeCompare(second.name, "pt-BR"),
      ),
    })),
  };
}
