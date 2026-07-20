import type { ProductCategory } from "@/types/category";
import type {
  Product,
  ProductImage,
} from "@/types/product";
import type {
  WooCommerceStoreCategory,
  WooCommerceStoreProduct,
} from "@/types/woocommerce";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  prime: "′",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
  times: "×",
};

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) =>
      namedEntities[name.toLowerCase()] ?? entity,
    );
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function convertMinorUnitPrice(
  value: string | undefined,
  minorUnit: number,
): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) {
    return undefined;
  }

  const safeMinorUnit =
    Number.isInteger(minorUnit) && minorUnit >= 0 && minorUnit <= 6
      ? minorUnit
      : 2;

  return Number(value) / 10 ** safeMinorUnit;
}

export function convertMajorUnitToMinorUnit(
  value: number | undefined,
  minorUnit: number,
): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const safeMinorUnit =
    Number.isInteger(minorUnit) && minorUnit >= 0 && minorUnit <= 6
      ? minorUnit
      : 2;

  return String(Math.round(value * 10 ** safeMinorUnit));
}

function mapImage(
  image: WooCommerceStoreProduct["images"][number],
): ProductImage {
  return {
    id: image.id,
    src: image.src,
    thumbnail: image.thumbnail,
    srcset: image.srcset,
    sizes: image.sizes,
    name: stripHtml(image.name),
    alt: stripHtml(image.alt),
  };
}

export function isWooCommerceStoreProduct(
  value: unknown,
): value is WooCommerceStoreProduct {
  if (!value || typeof value !== "object") {
    return false;
  }

  const product = value as Partial<WooCommerceStoreProduct>;

  return (
    typeof product.id === "number" &&
    typeof product.slug === "string" &&
    typeof product.name === "string" &&
    Boolean(product.prices) &&
    Array.isArray(product.images) &&
    Array.isArray(product.categories)
  );
}

export function mapStoreProduct(
  product: WooCommerceStoreProduct,
  featured = false,
): Product {
  const productName = stripHtml(product.name);
  const description = stripHtml(product.description);
  const shortDescription =
    stripHtml(product.short_description) ||
    description.slice(0, 240);
  const minorUnit = product.prices.currency_minor_unit;
  const price =
    convertMinorUnitPrice(product.prices.price, minorUnit) ?? 0;
  const regularPrice = convertMinorUnitPrice(
    product.prices.regular_price,
    minorUnit,
  );
  const salePrice = convertMinorUnitPrice(
    product.prices.sale_price,
    minorUnit,
  );
  const images = product.images.map((image) => {
    const mappedImage = mapImage(image);

    return {
      ...mappedImage,
      alt: mappedImage.alt || productName,
    };
  });

  return {
    id: product.id,
    slug: product.slug,
    type: product.type,
    name: productName,
    permalink: product.permalink,
    sku: product.sku,
    shortDescription,
    description,
    price,
    regularPrice,
    salePrice,
    currencyCode: product.prices.currency_code,
    currencySymbol: decodeHtmlEntities(
      product.prices.currency_symbol,
    ),
    currencyMinorUnit: minorUnit,
    image: images[0],
    images,
    categories: product.categories.map((category) => ({
      id: category.id,
      name: stripHtml(category.name),
      slug: category.slug,
      description: "",
      parent: 0,
      permalink: category.link,
    })),
    brands: (product.brands ?? []).map((brand) => ({
      id: brand.id,
      name: stripHtml(brand.name),
      slug: brand.slug,
      link: brand.link,
    })),
    available: product.is_in_stock && product.is_purchasable,
    stockStatus: product.is_in_stock ? "in-stock" : "out-of-stock",
    averageRating: Number.parseFloat(product.average_rating) || 0,
    reviewCount: product.review_count,
    featured,
    onSale: product.on_sale,
    attributes: (product.attributes ?? []).map((attribute) => ({
      id: attribute.id,
      name: stripHtml(attribute.name),
      taxonomy: attribute.taxonomy,
      hasVariations: attribute.has_variations,
      terms: attribute.terms.map((term) => ({
        id: term.id,
        name: stripHtml(term.name),
        slug: term.slug,
      })),
    })),
    variations: product.variations ?? [],
    hasOptions: product.has_options,
    isPurchasable: product.is_purchasable,
    commercialText: stripHtml(product.price_html),
  };
}

export function isWooCommerceStoreCategory(
  value: unknown,
): value is WooCommerceStoreCategory {
  if (!value || typeof value !== "object") {
    return false;
  }

  const category = value as Partial<WooCommerceStoreCategory>;

  return (
    typeof category.id === "number" &&
    typeof category.name === "string" &&
    typeof category.slug === "string" &&
    typeof category.parent === "number" &&
    typeof category.count === "number"
  );
}

export function mapStoreCategory(
  category: WooCommerceStoreCategory,
): ProductCategory {
  return {
    id: category.id,
    name: stripHtml(category.name),
    slug: category.slug,
    description: stripHtml(category.description ?? ""),
    parent: category.parent,
    count: category.count,
    image: category.image
      ? {
          id: category.image.id,
          src: category.image.src,
          thumbnail: category.image.thumbnail,
          srcset: category.image.srcset,
          sizes: category.image.sizes,
          name: stripHtml(category.image.name),
          alt: stripHtml(category.image.alt),
        }
      : undefined,
    permalink: category.permalink,
  };
}
