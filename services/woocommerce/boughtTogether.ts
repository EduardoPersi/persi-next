import "server-only";

import type {
  BoughtTogetherItem,
  BoughtTogetherResponse,
} from "@/types/boughtTogether";
import type { Product } from "@/types/product";
import { getBuyTogetherProducts } from "./recommendations";
import { persiHeadlessGet } from "./persiHeadlessClient";

interface BoughtTogetherOptions {
  productId: number;
  productSlug: string;
}

function isBoughtTogetherItem(value: unknown): value is BoughtTogetherItem {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<BoughtTogetherItem>;

  return (
    typeof item.productId === "number" &&
    item.productId > 0 &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    typeof item.slug === "string" &&
    item.slug.length > 0 &&
    typeof item.href === "string" &&
    typeof item.price === "string" &&
    Number.isFinite(Number(item.price)) &&
    Number(item.price) > 0 &&
    typeof item.currencyCode === "string" &&
    typeof item.inStock === "boolean" &&
    typeof item.purchasable === "boolean" &&
    typeof item.suggestedQuantity === "number" &&
    Number.isInteger(item.suggestedQuantity) &&
    item.suggestedQuantity > 0
  );
}

function getValidManualItems(value: unknown): BoughtTogetherItem[] {
  if (!value || typeof value !== "object") return [];

  const response = value as Partial<BoughtTogetherResponse>;

  return Array.isArray(response.items)
    ? response.items.filter(isBoughtTogetherItem)
    : [];
}

function mapAutomaticProduct(product: Product): BoughtTogetherItem {
  return {
    productId: product.id,
    name: product.name,
    slug: product.slug,
    href: `/produto/${product.slug}`,
    price: String(product.price),
    currencyCode: product.currencyCode,
    image: {
      src: product.image?.src ?? "",
      alt: product.image?.alt ?? product.name,
    },
    inStock: product.available,
    purchasable: product.isPurchasable !== false,
    suggestedQuantity: 1,
  };
}

function logSelection(message: "Using manual bought together" | "Using automatic algorithm") {
  if (process.env.NODE_ENV === "development") {
    console.info(message);
  }
}

export async function getBoughtTogether({
  productId,
  productSlug,
}: BoughtTogetherOptions): Promise<BoughtTogetherItem[]> {
  try {
    const manualResponse = await persiHeadlessGet<unknown>(
      `products/${productId}/bought-together`,
      60,
    );
    const manualItems = getValidManualItems(manualResponse);

    if (manualItems.length > 0) {
      logSelection("Using manual bought together");
      return manualItems;
    }
  } catch {
    // Endpoint ausente, desabilitado, inválido ou indisponível usa o algoritmo.
  }

  logSelection("Using automatic algorithm");

  const automaticProducts = await getBuyTogetherProducts(productSlug);
  return automaticProducts.map(mapAutomaticProduct);
}
