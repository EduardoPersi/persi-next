import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BrandCarousel } from "@/components/Brand/BrandCarousel";
import {
  CategoryProductsFallback,
  CategoryProductsInteractive,
} from "@/components/Category/CategoryProductsClient";
import { SubcategoryCarousel } from "@/components/Category/SubcategoryCarousel";
import { Header } from "@/components/Header/Header";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import { WordPressContent } from "@/components/UI/WordPressContent";
import { BreadcrumbBackLink } from "@/components/UI/BreadcrumbBackLink";
import { JsonLd } from "@/components/SEO/JsonLd";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getCategoryFilterData } from "@/services/woocommerce/filters";
import { getAvailabilityFirstProductsPage } from "@/services/woocommerce/products";
import type { ProductCategory } from "@/types/category";
import { getCategoryHref, SITE_URL } from "@/lib/routing/storefrontUrls";
import { buildBreadcrumbListJsonLd } from "@/lib/seo/productBreadcrumb";
import {
  buildCollectionPageJsonLd,
  buildProductItemListJsonLd,
} from "@/lib/seo/structuredData";

interface CategoryPageProps {
  params: Promise<{
    slug: string;
  }>;
}

function getCategoryPath(
  category: ProductCategory,
  categories: ProductCategory[],
): ProductCategory[] {
  const path: ProductCategory[] = [category];
  let parentId = category.parent;
  const visitedIds = new Set([category.id]);

  while (parentId > 0 && !visitedIds.has(parentId)) {
    const parent = categories.find((item) => item.id === parentId);

    if (!parent) {
      break;
    }

    path.unshift(parent);
    visitedIds.add(parent.id);
    parentId = parent.parent;
  }

  return path;
}

const PRODUCTS_PER_PAGE = 16;

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const categories = await getAllProductCategories();
    const category = categories.find((item) => item.slug === slug);

    if (!category) {
      return {
        title: "Categoria não encontrada | Persi Materiais",
        robots: { index: false, follow: false },
      };
    }

    const description =
      category.description.slice(0, 160) ||
      `Encontre produtos de ${category.name} na Persi Materiais, com entrega para Jundiaí e região.`;

    return {
      title: `${category.name} | Persi Materiais`,
      description,
      alternates: {
        canonical: getCategoryHref(category, categories),
      },
      openGraph: {
        locale: "pt_BR",
        title: `${category.name} | Persi Materiais`,
        description,
        type: "website",
        url: getCategoryHref(category, categories),
        images: category.image
          ? [
              {
                url: category.image.src,
                alt: category.image.alt || category.name,
              },
            ]
          : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: `${category.name} | Persi Materiais`,
        description,
        images: category.image ? [category.image.src] : undefined,
      },
    };
  } catch {
    return {
      title: "Categoria | Persi Materiais",
      robots: { index: false, follow: false },
    };
  }
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const categories = await getAllProductCategories();
  const category = categories.find((item) => item.slug === slug);

  if (!category) {
    notFound();
  }

  const subcategories = categories
    .filter((item) => item.parent === category.id && (item.count ?? 0) > 0)
    .sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));

  const [firstProductsPage, filterData] = await Promise.all([
    getAvailabilityFirstProductsPage({
      category: category.id,
      perPage: PRODUCTS_PER_PAGE,
      page: 1,
      order: "desc",
      orderby: "date",
    }),
    getCategoryFilterData(category.id).catch(() => ({
      minPrice: 0,
      maxPrice: 0,
      inStockCount: 0,
      onSaleAvailable: false,
      brands: [],
      attributes: [],
    })),
  ]);

  const pathname = getCategoryHref(category, categories);
  const categoryPath = getCategoryPath(category, categories);
  const categoryUrl = new URL(pathname, SITE_URL).toString();
  const categoryBreadcrumbItems = [
    { label: "Home", href: "/" },
    ...categoryPath.map((item, index) => ({
      label: item.name,
      href: getCategoryHref(item, categories),
      current: index === categoryPath.length - 1,
    })),
  ];
  const mobileBreadcrumbItems = categoryBreadcrumbItems
    .slice(
      Math.max(0, categoryBreadcrumbItems.length - 3),
      categoryBreadcrumbItems.length - 1,
    )
    .map((item) => ({ label: item.label, href: item.href }));
  const categoryJsonLd = buildCollectionPageJsonLd({
    name: category.name,
    description: category.description,
    url: categoryUrl,
    image: category.image?.src,
  });
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(
    categoryBreadcrumbItems,
    SITE_URL,
    pathname,
  );
  const itemListJsonLd = buildProductItemListJsonLd(
    firstProductsPage.products,
    SITE_URL,
  );

  return (
    <>
      <JsonLd data={[categoryJsonLd, breadcrumbJsonLd, itemListJsonLd]} />
      <Header />
      <main id="main-content" className="pt-2 pb-3 sm:py-6 lg:py-10">
        <Container>
          <nav aria-label="Breadcrumb" data-route-transition-skip>
            <BreadcrumbBackLink items={mobileBreadcrumbItems} />
            <ol className="hidden items-center gap-x-2 gap-y-1 text-xs text-muted sm:flex sm:flex-wrap sm:text-sm">
              <li>
                <Link
                  href="/"
                  className="tap-feedback rounded-sm px-0.5 transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Home
                </Link>
              </li>
              {categoryPath.map((breadcrumbCategory) => (
                <li
                  key={breadcrumbCategory.id}
                  className="flex min-w-0 items-center gap-2"
                >
                  <span aria-hidden="true">›</span>
                  {breadcrumbCategory.id === categoryPath.at(-1)?.id ? (
                    <span className="text-foreground" aria-current="page">
                      {breadcrumbCategory.name}
                    </span>
                  ) : (
                    <Link
                      href={getCategoryHref(breadcrumbCategory, categories)}
                      className="tap-feedback rounded-sm px-0.5 transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {breadcrumbCategory.name}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <Suspense
            fallback={
              <div
                className="mt-4 flex gap-3 overflow-hidden"
                aria-hidden="true"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-20 w-20 shrink-0 animate-pulse rounded-xl bg-slate-100"
                  />
                ))}
              </div>
            }
          >
            <SubcategoryCarousel
              category={category}
              allCategories={categories}
              subcategories={subcategories}
              includeMainCategory
            />
          </Suspense>

          <Suspense
            fallback={
              <CategoryProductsFallback
                categoryName={category.name}
                initialProducts={firstProductsPage.products}
                initialTotal={firstProductsPage.total}
              />
            }
          >
            <CategoryProductsInteractive
              categorySlug={category.slug}
              categoryName={category.name}
              pathname={pathname}
              filterData={filterData}
              initialProducts={firstProductsPage.products}
              initialTotal={firstProductsPage.total}
            />
          </Suspense>

          {category.descriptionHtml ? (
            <section
              className="mt-10 border-t border-slate-200 pt-8"
              aria-labelledby="category-description-title"
            >
              <h2
                id="category-description-title"
                className="text-xl font-bold text-primary"
              >
                Sobre {category.name}
              </h2>
              <WordPressContent
                html={category.descriptionHtml}
                variant="storefront"
                className="mt-4"
              />
            </section>
          ) : null}

          <BrandCarousel brands={filterData.brands} pathname={pathname} />

          <RecentlyViewedProducts />
        </Container>
      </main>
    </>
  );
}
