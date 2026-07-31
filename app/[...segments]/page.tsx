import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CategoryPage, {
  generateMetadata as generateCategoryMetadata,
} from "@/app/_storefront/category-page";
import InstitutionalPage, {
  generateMetadata as generateInstitutionalMetadata,
} from "@/app/_storefront/institutional-page";
import ProductPage, {
  generateMetadata as generateProductMetadata,
} from "@/app/_storefront/product-page";
import {
  findCategoryByPath,
  RESERVED_ROOT_SLUGS,
} from "@/lib/routing/storefrontUrls";
import { isInstitutionalRouteSlug } from "@/lib/constants/institutionalPages";
import { getAllProductCategories } from "@/services/woocommerce/categories";

type PublicPageProps = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolvePublicRoute(segments: string[]) {
  if (segments.length === 1 && isInstitutionalRouteSlug(segments[0])) {
    return { type: "institutional" as const, slug: segments[0] };
  }

  const categories = await getAllProductCategories({ hideEmpty: false }).catch(
    () => [],
  );
  const category = findCategoryByPath(segments, categories);
  if (category) return { type: "category" as const, slug: category.slug };

  if (
    segments.length === 1 &&
    !RESERVED_ROOT_SLUGS.has(segments[0])
  ) {
    return { type: "product" as const, slug: segments[0] };
  }

  return undefined;
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicPageProps): Promise<Metadata> {
  const { segments } = await params;
  const route = await resolvePublicRoute(segments);
  if (!route) return { robots: { index: false, follow: false } };

  const routeParams = Promise.resolve({ slug: route.slug });
  if (route.type === "institutional") {
    return generateInstitutionalMetadata({ params: routeParams });
  }
  if (route.type === "category") {
    return generateCategoryMetadata({ params: routeParams, searchParams });
  }
  return generateProductMetadata({ params: routeParams });
}

export default async function PublicPage({
  params,
  searchParams,
}: PublicPageProps) {
  const { segments } = await params;
  const route = await resolvePublicRoute(segments);
  if (!route) notFound();

  const routeParams = Promise.resolve({ slug: route.slug });
  if (route.type === "institutional") {
    return InstitutionalPage({ params: routeParams });
  }
  if (route.type === "category") {
    return CategoryPage({ params: routeParams, searchParams });
  }
  return ProductPage({ params: routeParams });
}
