import type {
  CatalogAttributeFilter,
  CatalogFilterData,
  CatalogFilterOption,
} from "@/types/catalog-filters";
import { getAllProductBrands } from "./brands";
import { storeApiGet } from "./client";
import { decodeHtmlEntities } from "./mappers";

interface WooProductAttribute {
  id: number;
  name: string;
  taxonomy: string;
}

interface WooAttributeTerm {
  id: number;
  name: string;
  slug: string;
}

interface WooCollectionCount {
  term: number;
  count: number | string;
}

interface WooCollectionData {
  price_range?: {
    min_price?: string;
    max_price?: string;
    currency_minor_unit?: number;
  } | null;
  attribute_counts?: WooCollectionCount[] | null;
  taxonomy_counts?: WooCollectionCount[] | null;
  stock_status_counts?: Array<{
    status: string;
    count: number | string;
  }> | null;
}

function isAttribute(value: unknown): value is WooProductAttribute {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WooProductAttribute>;
  return (
    typeof item.id === "number" &&
    typeof item.name === "string" &&
    typeof item.taxonomy === "string"
  );
}

function isTerm(value: unknown): value is WooAttributeTerm {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WooAttributeTerm>;
  return (
    typeof item.id === "number" &&
    typeof item.name === "string" &&
    typeof item.slug === "string"
  );
}

export async function getCategoryFilterData(
  categoryId: number,
): Promise<CatalogFilterData> {
  const attributesResponse = await storeApiGet<unknown>(
    "products/attributes",
  );
  const attributes = Array.isArray(attributesResponse)
    ? attributesResponse
        .filter(isAttribute)
        .filter((attribute) => attribute.taxonomy !== "pa_marca")
    : [];
  const query: Record<string, string | number | boolean> = {
    category: categoryId,
    calculate_price_range: true,
    calculate_stock_status_counts: true,
    calculate_taxonomy_counts: "product_brand",
  };
  attributes.forEach((attribute, index) => {
    query[`calculate_attribute_counts[${index}][taxonomy]`] =
      attribute.taxonomy;
    query[`calculate_attribute_counts[${index}][query_type]`] = "or";
  });

  const [collection, saleCollection, termLists, brands] = await Promise.all([
    storeApiGet<WooCollectionData>("products/collection-data", {
      query,
    }),
    storeApiGet<WooCollectionData>("products/collection-data", {
      query: {
        category: categoryId,
        on_sale: true,
        calculate_price_range: true,
      },
    }),
    Promise.all(
      attributes.map(async (attribute) => {
        const response = await storeApiGet<unknown>(
          `products/attributes/${attribute.id}/terms`,
          { query: { per_page: 100 } },
        );
        return Array.isArray(response) ? response.filter(isTerm) : [];
      }),
    ),
    getAllProductBrands(),
  ]);
  const attributeCounts = new Map(
    (collection.attribute_counts ?? []).map((item) => [
      item.term,
      Number(item.count) || 0,
    ]),
  );
  const brandCounts = new Map(
    (collection.taxonomy_counts ?? []).map((item) => [
      item.term,
      Number(item.count) || 0,
    ]),
  );
  const mappedAttributes: CatalogAttributeFilter[] = attributes
    .map((attribute, index) => ({
      id: attribute.id,
      name: decodeHtmlEntities(attribute.name),
      taxonomy: attribute.taxonomy,
      options: termLists[index]
        .map(
          (term): CatalogFilterOption => ({
            id: term.id,
            name: decodeHtmlEntities(term.name),
            slug: term.slug,
            count: attributeCounts.get(term.id) ?? 0,
          }),
        )
        .filter((term) => term.count > 0)
        .sort((first, second) =>
          first.name.localeCompare(second.name, "pt-BR"),
        ),
    }))
    .filter((attribute) => attribute.options.length > 0);
  const minorUnit = collection.price_range?.currency_minor_unit ?? 2;
  const stockCounts = new Map(
    (collection.stock_status_counts ?? []).map((item) => [
      item.status,
      Number(item.count) || 0,
    ]),
  );

  return {
    minPrice:
      Number(collection.price_range?.min_price ?? 0) / 10 ** minorUnit,
    maxPrice:
      Number(collection.price_range?.max_price ?? 0) / 10 ** minorUnit,
    inStockCount: stockCounts.get("instock") ?? 0,
    onSaleAvailable: Boolean(saleCollection.price_range),
    brands: brands
      .map((brand) => ({
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        count: brandCounts.get(brand.id) ?? 0,
        image: brand.image
          ? {
              src: brand.image.src,
              alt: brand.image.alt || `Logo ${brand.name}`,
            }
          : undefined,
      }))
      .filter((brand) => brand.count > 0)
      .sort((first, second) =>
        first.name.localeCompare(second.name, "pt-BR"),
      ),
    attributes: mappedAttributes,
  };
}
