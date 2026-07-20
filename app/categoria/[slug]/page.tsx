import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandCarousel } from "@/components/Brand/BrandCarousel";
import {
  CategoryFilters,
  type CategoryFilterValues,
} from "@/components/Category/CategoryFilters";
import { LoadMoreButton } from "@/components/Category/LoadMoreButton";
import { CategorySort } from "@/components/Category/CategorySort";
import { SubcategoryCarousel } from "@/components/Category/SubcategoryCarousel";
import { Header } from "@/components/Header/Header";
import { ProductCard } from "@/components/Product/ProductCard";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import { getBrandByIdentifier } from "@/services/woocommerce/brands";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getCategoryFilterData } from "@/services/woocommerce/filters";
import {
  getAvailabilityFirstProductsPage,
  type GetProductsOptions,
} from "@/services/woocommerce/products";
import type { ProductCategory } from "@/types/category";

type RawSearchParams = Record<
  string,
  string | string[] | undefined
>;

interface CategoryPageProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<RawSearchParams>;
}

function getSingleParam(
  params: RawSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function getPositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
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

function isCategoryDescendant(
  candidate: ProductCategory,
  rootCategory: ProductCategory,
  categories: ProductCategory[],
): boolean {
  let parentId = candidate.parent;
  const visitedIds = new Set([candidate.id]);

  while (parentId > 0 && !visitedIds.has(parentId)) {
    if (parentId === rootCategory.id) return true;

    const parent = categories.find((item) => item.id === parentId);
    if (!parent) return false;

    visitedIds.add(parent.id);
    parentId = parent.parent;
  }

  return false;
}

function getOrderOptions(order: string): Pick<
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

function normalizeSearchParams(
  searchParams: RawSearchParams,
): Record<string, string> {
  const normalized: Record<string, string> = {};

  Object.entries(searchParams).forEach(([key, value]) => {
    const singleValue = Array.isArray(value) ? value[0] : value;

    if (singleValue) {
      normalized[key] = singleValue;
    }
  });

  return normalized;
}

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const [{ slug }, rawSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const brandIdentifier = getSingleParam(rawSearchParams, "marca");

  try {
    const [categories, selectedBrand] = await Promise.all([
      getAllProductCategories(),
      brandIdentifier
        ? getBrandByIdentifier(brandIdentifier).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    const category = categories.find((item) => item.slug === slug);

    if (!category) {
      return {
        title: "Categoria não encontrada | Persi Materiais",
        robots: { index: false, follow: false },
      };
    }

    const contextName = selectedBrand?.name ?? category.name;
    const description = selectedBrand
      ? selectedBrand.description.slice(0, 160) ||
        `Encontre produtos ${selectedBrand.name} na Persi Materiais, com opções para sua obra e entrega para Jundiaí e região.`
      : category.description.slice(0, 160) ||
        `Encontre produtos de ${category.name} na Persi Materiais, com entrega para Jundiaí e região.`;
    const contextImage = selectedBrand?.image ?? category.image;

    return {
      title: `${contextName} | Persi Materiais`,
      description,
      alternates: {
        canonical: `/categoria/${category.slug}`,
      },
      robots: brandIdentifier
        ? { index: false, follow: true }
        : undefined,
      openGraph: {
        title: `${contextName} | Persi Materiais`,
        description,
        type: "website",
        images: contextImage
          ? [
              {
                url: contextImage.src,
                alt: contextImage.alt || contextName,
              },
            ]
          : undefined,
      },
    };
  } catch {
    return {
      title: "Categoria | Persi Materiais",
      robots: { index: false, follow: false },
    };
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const [{ slug }, rawSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const categories = await getAllProductCategories();
  const category = categories.find((item) => item.slug === slug);

  if (!category) {
    notFound();
  }

  const subcategories = categories
    .filter((item) => item.parent === category.id && (item.count ?? 0) > 0)
    .sort((first, second) =>
      first.name.localeCompare(second.name, "pt-BR"),
    );
  const selectedSubcategorySlug = getSingleParam(
    rawSearchParams,
    "subcategoria",
  );
  const selectedSubcategory = categories.find(
    (item) =>
      item.slug === selectedSubcategorySlug &&
      isCategoryDescendant(item, category, categories),
  );
  const selectedCategoryChildren = selectedSubcategory
    ? categories
        .filter(
          (item) =>
            item.parent === selectedSubcategory.id &&
            (item.count ?? 0) > 0,
        )
        .sort((first, second) =>
          first.name.localeCompare(second.name, "pt-BR"),
        )
    : [];
  const selectorSubcategories = selectedSubcategory
    ? selectedCategoryChildren.length > 0
      ? selectedCategoryChildren
      : categories
          .filter(
            (item) =>
              item.parent === selectedSubcategory.parent &&
              (item.count ?? 0) > 0,
          )
          .sort((first, second) =>
            first.name.localeCompare(second.name, "pt-BR"),
          )
    : subcategories;
  const currentPage = getPositiveInteger(
    getSingleParam(rawSearchParams, "pagina"),
    1,
  );
  const currentOrder =
    getSingleParam(rawSearchParams, "ordem") ?? "recentes";
  const minPrice = getSingleParam(rawSearchParams, "preco_min");
  const maxPrice = getSingleParam(rawSearchParams, "preco_max");
  const availability = getSingleParam(rawSearchParams, "estoque");
  const promotion = getSingleParam(rawSearchParams, "promocao");
  const brandIdentifier = getSingleParam(rawSearchParams, "marca");
  const selectedBrand = brandIdentifier
    ? await getBrandByIdentifier(brandIdentifier).catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.error("Erro ao identificar a marca selecionada:", error);
        }
        return undefined;
      })
    : undefined;

  if (
    brandIdentifier &&
    !selectedBrand &&
    process.env.NODE_ENV === "development"
  ) {
    console.error(`Marca selecionada não encontrada: ${brandIdentifier}`);
  }

  const selectedAttributeValues: Record<string, string> = {};

  Object.entries(rawSearchParams).forEach(([key, value]) => {
    if (!key.startsWith("atributo_")) return;

    const normalizedValue = Array.isArray(value)
      ? value.join(",")
      : value ?? "";
    if (normalizedValue) {
      selectedAttributeValues[key.replace(/^atributo_/, "")] =
        normalizedValue;
    }
  });
  const orderOptions = getOrderOptions(currentOrder);
  const productsPerPage = 16;
  const productOptions: GetProductsOptions = {
    category: selectedSubcategory?.id ?? category.id,
    perPage: productsPerPage,
    minPrice: getPositiveNumber(minPrice),
    maxPrice: getPositiveNumber(maxPrice),
    stockStatus:
      availability === "disponivel" ? "instock" : undefined,
    onSale: promotion === "sim" ? true : undefined,
    brand: selectedBrand ? brandIdentifier : undefined,
    attributes: Object.entries(selectedAttributeValues).map(
      ([taxonomy, attributeSlug]) => ({
        taxonomy,
        slug: attributeSlug,
      }),
    ),
    ...orderOptions,
  };
  const [firstProductsPage, filterData] = await Promise.all([
    getAvailabilityFirstProductsPage({
      page: 1,
      ...productOptions,
    }),
    getCategoryFilterData(
      selectedSubcategory?.id ?? category.id,
    ).catch(() => ({
      minPrice: 0,
      maxPrice: 0,
      inStockCount: 0,
      onSaleAvailable: false,
      brands: [],
      attributes: [],
    })),
  ]);
  const loadedPageCount = Math.min(
    currentPage,
    Math.max(firstProductsPage.totalPages, 1),
  );
  const additionalProductPages =
    loadedPageCount > 1
      ? await Promise.all(
          Array.from(
            { length: loadedPageCount - 1 },
            (_, index) =>
              getAvailabilityFirstProductsPage({
                page: index + 2,
                ...productOptions,
              }),
          ),
        )
      : [];
  const productsPage = {
    ...firstProductsPage,
    products: [
      ...firstProductsPage.products,
      ...additionalProductPages.flatMap((page) => page.products),
    ],
  };
  const breadcrumbCategories = selectedBrand
    ? []
    : getCategoryPath(selectedSubcategory ?? category, categories);
  const pathname = `/categoria/${category.slug}`;
  const contextName =
    selectedBrand?.name ?? selectedSubcategory?.name ?? category.name;
  const contextDescription = selectedBrand
    ? selectedBrand.description
    : category.description;
  const filterValues: CategoryFilterValues = {
    minPrice,
    maxPrice,
    availability,
    promotion,
    brand: selectedBrand ? brandIdentifier : undefined,
    subcategory: selectedSubcategory?.slug,
    order: currentOrder,
    attributes: selectedAttributeValues,
  };
  const normalizedParams = normalizeSearchParams(rawSearchParams);
  if (brandIdentifier && !selectedBrand) {
    delete normalizedParams.marca;
  }
  const preservedSortParams = { ...normalizedParams };
  delete preservedSortParams.ordem;
  delete preservedSortParams.pagina;
  const loadMoreParams = {
    ...normalizedParams,
    pagina: String(loadedPageCount + 1),
  };
  const hasMoreProducts =
    productsPage.products.length < productsPage.total;

  return (
    <>
      <Header />
      <main className="py-6 sm:py-8 lg:py-10">
        <Container>
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 sm:text-sm">
              <li>
                <Link
                  href="/"
                  className="rounded-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                >
                  Home
                </Link>
              </li>
              {selectedBrand ? (
                <li className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true">›</span>
                  <span className="text-slate-800" aria-current="page">
                    {selectedBrand.name}
                  </span>
                </li>
              ) : (
                breadcrumbCategories.map((breadcrumbCategory) => (
                  <li
                    key={breadcrumbCategory.id}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span aria-hidden="true">›</span>
                    {breadcrumbCategory.id ===
                    breadcrumbCategories.at(-1)?.id ? (
                      <span className="text-slate-800" aria-current="page">
                        {breadcrumbCategory.name}
                      </span>
                    ) : (
                      <Link
                        href={`/categoria/${breadcrumbCategory.slug}`}
                        className="rounded-sm hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
                      >
                        {breadcrumbCategory.name}
                      </Link>
                    )}
                  </li>
                ))
              )}
            </ol>
          </nav>

          <SubcategoryCarousel
            category={category}
            subcategories={selectorSubcategories}
            pathname={pathname}
            selectedSlug={selectedSubcategory?.slug}
            includeMainCategory={!selectedSubcategory}
          />

          <div className="mt-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-4">
            <div className="hidden lg:block">
              <CategoryFilters
                key={`desktop-${JSON.stringify(filterValues)}`}
                mode="desktop"
                pathname={pathname}
                values={filterValues}
                filterData={filterData}
              />
            </div>

            <div className="min-w-0">
              <div className="flex flex-col gap-4 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-[#0c2d72]">
                      {contextName}
                    </h1>
                    <p className="sr-only" aria-live="polite">
                      {productsPage.total}{" "}
                      {productsPage.total === 1
                        ? "produto encontrado"
                        : "produtos encontrados"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <CategoryFilters
                    key={`mobile-${JSON.stringify(filterValues)}`}
                    mode="mobile"
                    pathname={pathname}
                    values={filterValues}
                    filterData={filterData}
                  />
                  <CategorySort
                    key={currentOrder}
                    pathname={pathname}
                    currentOrder={currentOrder}
                    preservedParams={preservedSortParams}
                  />
                </div>
              </div>

              <div className="mt-6">
                {productsPage.products.length > 0 ? (
                  <>
                    <div
                      className="grid grid-cols-2 gap-[10px] md:grid-cols-3 lg:grid-cols-4"
                      aria-busy="false"
                    >
                      {productsPage.products.map((product) => (
                        <ProductCard
                          key={product.id}
                          name={product.name}
                          image={product.image?.src ?? ""}
                          images={product.images}
                          href={`/produto/${product.slug}`}
                          price={product.price}
                          regularPrice={
                            product.onSale
                              ? product.regularPrice
                              : undefined
                          }
                          currencyCode={product.currencyCode}
                          commercialText={product.commercialText}
                          brand={product.brands[0]?.name}
                          badge={product.onSale ? "Oferta" : undefined}
                          available={product.available}
                          showAddToCart
                          productId={product.id}
                          productSlug={product.slug}
                          productType={product.type}
                          isPurchasable={product.isPurchasable}
                          hasOptions={product.hasOptions}
                        />
                      ))}
                    </div>
                    {hasMoreProducts ? (
                      <div className="mt-8 flex justify-center">
                        <LoadMoreButton
                          pathname={pathname}
                          searchParams={loadMoreParams}
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                    <h2 className="text-lg font-semibold text-[#0c2d72]">
                      Nenhum produto encontrado
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Tente remover alguns filtros ou escolher outra
                      subcategoria.
                    </p>
                    <Link
                      href={pathname}
                      className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-[#ff6a00] px-5 text-sm font-semibold text-white"
                    >
                      Limpar filtros
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          {contextDescription ? (
            <section
              className="mt-10 border-t border-slate-200 pt-8"
              aria-labelledby="category-description-title"
            >
              <h2
                id="category-description-title"
                className="text-xl font-semibold text-[#0c2d72]"
              >
                Sobre {contextName}
              </h2>
              <p className="mt-4 whitespace-pre-line text-left leading-7 text-slate-700">
                {contextDescription}
              </p>
            </section>
          ) : null}

          <BrandCarousel
            brands={filterData.brands}
            pathname={pathname}
            subcategorySlug={selectedSubcategory?.slug}
          />

          <RecentlyViewedProducts />
        </Container>
      </main>
    </>
  );
}
