import type { Metadata } from "next";
import Link from "next/link";
import {
  CategoryFilters,
  type CategoryFilterValues,
} from "@/components/Category/CategoryFilters";
import { CategorySort } from "@/components/Category/CategorySort";
import { LoadMoreButton } from "@/components/Category/LoadMoreButton";
import { Header } from "@/components/Header/Header";
import { ProductCard } from "@/components/Product/ProductCard";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import {
  getAvailabilityFirstProductsPage,
  type GetProductsOptions,
} from "@/services/woocommerce/products";
import {
  getFilterContextProducts,
  getSearchFilterData,
  type ProductSearchOrder,
} from "@/services/woocommerce/search";

type RawSearchParams = Record<string, string | string[] | undefined>;

interface PromotionsPageProps {
  searchParams: Promise<RawSearchParams>;
}

export const metadata: Metadata = {
  title: "Promoções | Persi Materiais",
  description:
    "Confira produtos em promoção na Persi Materiais para sua obra, com entrega para Jundiaí e região.",
  alternates: { canonical: "/promocoes" },
  openGraph: {
    title: "Promoções | Persi Materiais",
    description:
      "Ofertas em materiais para construção, ferramentas, hidráulica, elétrica e muito mais.",
    type: "website",
  },
};

function getSingleParam(params: RawSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function getPositiveNumber(value?: string) {
  if (!value) return undefined;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeSearchParams(params: RawSearchParams) {
  const normalized: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    const singleValue = Array.isArray(value) ? value[0] : value;
    if (singleValue) normalized[key] = singleValue;
  });
  return normalized;
}

function getOrderOptions(order: ProductSearchOrder): Pick<
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

export default async function PromotionsPage({
  searchParams,
}: PromotionsPageProps) {
  const rawSearchParams = await searchParams;
  const pathname = "/promocoes";
  const currentPage = getPositiveInteger(
    getSingleParam(rawSearchParams, "pagina"),
    1,
  );
  const currentOrder =
    (getSingleParam(rawSearchParams, "ordem") as ProductSearchOrder) ??
    "recentes";
  const minPrice = getSingleParam(rawSearchParams, "preco_min");
  const maxPrice = getSingleParam(rawSearchParams, "preco_max");
  const availability = getSingleParam(rawSearchParams, "estoque");
  const brand = getSingleParam(rawSearchParams, "marca");
  const category = getSingleParam(rawSearchParams, "categoria");
  const selectedAttributes: Record<string, string> = {};

  Object.entries(rawSearchParams).forEach(([key, value]) => {
    if (!key.startsWith("atributo_")) return;
    const normalizedValue = Array.isArray(value) ? value.join(",") : value;
    if (normalizedValue) {
      selectedAttributes[key.replace(/^atributo_/, "")] = normalizedValue;
    }
  });

  const productOptions: GetProductsOptions = {
    perPage: 16,
    onSale: true,
    minPrice: getPositiveNumber(minPrice),
    maxPrice: getPositiveNumber(maxPrice),
    stockStatus: availability === "disponivel" ? "instock" : undefined,
    brand,
    category,
    attributes: Object.entries(selectedAttributes).map(
      ([taxonomy, slug]) => ({ taxonomy, slug }),
    ),
    ...getOrderOptions(currentOrder),
  };
  const [firstPage, promotionProducts] = await Promise.all([
    getAvailabilityFirstProductsPage({ ...productOptions, page: 1 }),
    getFilterContextProducts({ onSale: true }),
  ]);
  const loadedPageCount = Math.min(
    currentPage,
    Math.max(firstPage.totalPages, 1),
  );
  const additionalPages =
    loadedPageCount > 1
      ? await Promise.all(
          Array.from({ length: loadedPageCount - 1 }, (_, index) =>
            getAvailabilityFirstProductsPage({
              ...productOptions,
              page: index + 2,
            }),
          ),
        )
      : [];
  const products = [
    ...firstPage.products,
    ...additionalPages.flatMap((page) => page.products),
  ];
  const contextualFilterData = await getSearchFilterData(promotionProducts);
  const filterData = {
    ...contextualFilterData,
    onSaleAvailable: false,
  };
  const filterValues: CategoryFilterValues = {
    minPrice,
    maxPrice,
    availability,
    brand,
    category,
    order: currentOrder,
    attributes: selectedAttributes,
  };
  const normalizedParams = normalizeSearchParams(rawSearchParams);
  delete normalizedParams.promocao;
  const preservedSortParams = { ...normalizedParams };
  delete preservedSortParams.ordem;
  delete preservedSortParams.pagina;
  const loadMoreParams = {
    ...normalizedParams,
    pagina: String(loadedPageCount + 1),
  };
  const hasMoreProducts = products.length < firstPage.total;

  return (
    <>
      <Header />
      <main className="py-3 sm:py-6 lg:py-10">
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
              <li className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true">›</span>
                <span className="text-slate-800" aria-current="page">
                  Promoções
                </span>
              </li>
            </ol>
          </nav>

          <section className="mt-5 overflow-hidden rounded-xl bg-gradient-to-r from-[#071f5c] via-[#0c2d72] to-[#ff6a00] px-5 py-5 text-white sm:px-8 sm:py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              Ofertas selecionadas
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Promoções</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/90">
              Produtos com preços promocionais ativos no catálogo da Persi.
            </p>
          </section>

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
                <p className="text-sm text-slate-600" aria-live="polite">
                  <strong className="text-slate-900">{firstPage.total}</strong>{" "}
                  {firstPage.total === 1
                    ? "produto em promoção"
                    : "produtos em promoção"}
                </p>
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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
                {products.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-[10px] md:grid-cols-3 lg:grid-cols-4">
                      {products.map((product) => (
                        <ProductCard
                          key={product.id}
                          name={product.name}
                          image={product.image?.src ?? ""}
                          images={product.images}
                          href={`/produto/${product.slug}`}
                          price={product.price}
                          regularPrice={product.regularPrice}
                          currencyCode={product.currencyCode}
                          commercialText={product.commercialText}
                          brand={product.brands[0]?.name}
                          badge="Oferta"
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
                    <h2 className="text-lg font-bold text-[#0c2d72]">
                      Nenhuma promoção encontrada
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Tente remover alguns filtros para visualizar outras ofertas.
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

          <RecentlyViewedProducts />
        </Container>
      </main>
    </>
  );
}
