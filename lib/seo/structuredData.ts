import { getProductHref } from "@/lib/routing/storefrontUrls";

interface CollectionPageJsonLdInput {
  name: string;
  description?: string;
  url: string;
  image?: string;
  brand?: { name: string };
}

export function buildCollectionPageJsonLd({
  name,
  description,
  url,
  image,
  brand,
}: CollectionPageJsonLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description: description || undefined,
    url,
    image: image || undefined,
    brand: brand ? { "@type": "Brand", name: brand.name } : undefined,
  };
}

const ITEM_LIST_LIMIT = 20;

interface ItemListProductInput {
  slug: string;
  name: string;
}

export function buildProductItemListJsonLd(
  products: readonly ItemListProductInput[],
  siteUrl: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.slice(0, ITEM_LIST_LIMIT).map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: new URL(getProductHref(product.slug), siteUrl).toString(),
      name: product.name,
    })),
  };
}
