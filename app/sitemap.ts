import type { MetadataRoute } from "next";
import { institutionalPageMap } from "@/lib/constants/institutionalPages";
import {
  getCategoryHref,
  getProductHref,
  getCategoryPath,
  RESERVED_ROOT_SLUGS,
  SITE_URL,
} from "@/lib/routing/storefrontUrls";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getAllProducts } from "@/services/woocommerce/products";

export const revalidate = 86_400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([
    getAllProductCategories({
      hideEmpty: false,
      revalidate: 86_400,
    }).catch(() => []),
    getAllProducts().catch(() => []),
  ]);
  const url = (pathname: string) => new URL(pathname, SITE_URL).toString();
  const publicCategories = categories.filter((category) => {
    const rootSlug = getCategoryPath(category, categories)[0]?.slug;
    return rootSlug && !RESERVED_ROOT_SLUGS.has(rootSlug);
  });
  const rootCategorySlugs = new Set(
    publicCategories
      .filter((category) => category.parent === 0)
      .map((category) => category.slug),
  );
  const publicProducts = products.filter(
    (product) =>
      !RESERVED_ROOT_SLUGS.has(product.slug) &&
      !rootCategorySlugs.has(product.slug),
  );

  return [
    { url: url("/"), changeFrequency: "daily", priority: 1 },
    { url: url("/promocoes"), changeFrequency: "daily", priority: 0.8 },
    ...Object.keys(institutionalPageMap).map((slug) => ({
      url: url(`/${slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
    ...publicCategories.map((category) => ({
      url: url(getCategoryHref(category, categories)),
      changeFrequency: "daily" as const,
      priority: category.parent === 0 ? 0.8 : 0.7,
    })),
    ...publicProducts.map((product) => ({
      url: url(getProductHref(product.slug)),
      lastModified: product.dateCreated
        ? new Date(product.dateCreated)
        : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
