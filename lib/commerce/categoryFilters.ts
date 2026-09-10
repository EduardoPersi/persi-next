import type { GetProductsOptions } from "@/services/woocommerce/products";

/** Minimal shape shared by URLSearchParams and Next's ReadonlyURLSearchParams. */
export interface SearchParamsLike {
  get(key: string): string | null;
  forEach(callback: (value: string, key: string) => void): void;
}

export function getPositiveNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function getPositiveInteger(value: string | null, fallback: number) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export function getOrderOptions(order: string): Pick<
  GetProductsOptions,
  "order" | "orderby"
> {
  switch (order) {
    case "menor-preco":
      return { order: "asc", orderby: "price" };
    case "maior-preco":
      return { order: "desc", orderby: "price" };
    case "mais-vendidos":
      return { order: "desc", orderby: "popularity" };
    case "nome-az":
      return { order: "asc", orderby: "title" };
    default:
      return { order: "desc", orderby: "date" };
  }
}

export function normalizeSearchParams(
  searchParams: SearchParamsLike,
): Record<string, string> {
  const normalized: Record<string, string> = {};

  searchParams.forEach((value, key) => {
    if (value) normalized[key] = value;
  });

  return normalized;
}

export function getSelectedAttributeValues(
  searchParams: SearchParamsLike,
): Record<string, string> {
  const selectedAttributeValues: Record<string, string> = {};

  searchParams.forEach((value, key) => {
    if (!key.startsWith("atributo_") || !value) return;
    selectedAttributeValues[key.replace(/^atributo_/, "")] = value;
  });

  return selectedAttributeValues;
}

/** Params that affect which products are shown/how they're ordered. */
export const FILTER_PARAM_KEYS = [
  "pagina",
  "ordem",
  "preco_min",
  "preco_max",
  "estoque",
  "promocao",
  "marca",
] as const;

export function hasActiveFilterParams(searchParams: SearchParamsLike): boolean {
  const hasKnownParam = FILTER_PARAM_KEYS.some((key) =>
    Boolean(searchParams.get(key)),
  );
  if (hasKnownParam) return true;

  let hasAttributeParam = false;
  searchParams.forEach((value, key) => {
    if (key.startsWith("atributo_") && value) hasAttributeParam = true;
  });
  return hasAttributeParam;
}

interface BuildProductOptionsArgs {
  categoryId: number;
  searchParams: SearchParamsLike;
  brandIdentifier?: string;
  perPage?: number;
}

export function buildProductOptionsFromParams({
  categoryId,
  searchParams,
  brandIdentifier,
  perPage = 16,
}: BuildProductOptionsArgs): GetProductsOptions {
  const currentOrder = searchParams.get("ordem") ?? "recentes";
  const availability = searchParams.get("estoque");
  const promotion = searchParams.get("promocao");
  const selectedAttributeValues = getSelectedAttributeValues(searchParams);
  const orderOptions = getOrderOptions(currentOrder);

  return {
    category: categoryId,
    perPage,
    minPrice: getPositiveNumber(searchParams.get("preco_min")),
    maxPrice: getPositiveNumber(searchParams.get("preco_max")),
    stockStatus: availability === "disponivel" ? "instock" : undefined,
    onSale: promotion === "sim" ? true : undefined,
    brand: brandIdentifier,
    attributes: Object.entries(selectedAttributeValues).map(
      ([taxonomy, attributeSlug]) => ({
        taxonomy,
        slug: attributeSlug,
      }),
    ),
    ...orderOptions,
  };
}
