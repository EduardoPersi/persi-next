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
  filterAndSortSearchProducts,
  getSearchFilterData,
  searchWooCommerceProducts,
  type ProductSearchFilters,
  type ProductSearchOrder,
} from "@/services/woocommerce/search";

type RawSearchParams = Record<string, string | string[] | undefined>;

interface SearchPageProps {
  searchParams: Promise<RawSearchParams>;
}

export const metadata: Metadata = {
  title: "Busca | Persi Materiais",
  description: "Pesquise produtos no catálogo da Persi Materiais.",
  robots: { index: false, follow: true },
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

function splitParam(value?: string) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeSearchParams(params: RawSearchParams) {
  const normalized: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    const singleValue = Array.isArray(value) ? value[0] : value;
    if (singleValue) normalized[key] = singleValue;
  });
  return normalized;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawSearchParams = await searchParams;
  const query = (getSingleParam(rawSearchParams, "q") ?? "").trim().slice(0, 100);
  const currentPage = getPositiveInteger(
    getSingleParam(rawSearchParams, "pagina"),
    1,
  );
  const currentOrder =
    (getSingleParam(rawSearchParams, "ordem") as ProductSearchOrder) ??
    "relevancia";
  const minPrice = getSingleParam(rawSearchParams, "preco_min");
  const maxPrice = getSingleParam(rawSearchParams, "preco_max");
  const availability = getSingleParam(rawSearchParams, "estoque");
  const promotion = getSingleParam(rawSearchParams, "promocao");
  const brand = getSingleParam(rawSearchParams, "marca");
  const category = getSingleParam(rawSearchParams, "categoria");
  const selectedAttributes: Record<string, string[]> = {};

  Object.entries(rawSearchParams).forEach(([key, value]) => {
    if (!key.startsWith("atributo_")) return;
    const normalizedValue = Array.isArray(value) ? value.join(",") : value;
    const selected = splitParam(normalizedValue);
    if (selected.length > 0) {
      selectedAttributes[key.replace(/^atributo_/, "")] = selected;
    }
  });

  let allProducts = [] as Awaited<ReturnType<typeof searchWooCommerceProducts>>;
  let searchFailed = false;

  if (query) {
    try {
      allProducts = await searchWooCommerceProducts(query);
    } catch {
      searchFailed = true;
    }
  }

  const filters: ProductSearchFilters = {
    minPrice: getPositiveNumber(minPrice),
    maxPrice: getPositiveNumber(maxPrice),
    inStockOnly: availability === "disponivel",
    onSaleOnly: promotion === "sim",
    brands: splitParam(brand),
    categories: splitParam(category),
    attributes: selectedAttributes,
  };
  const filteredProducts = filterAndSortSearchProducts(
    allProducts,
    query,
    filters,
    currentOrder,
  );
  const productsPerPage = 16;
  const loadedPageCount = Math.min(
    currentPage,
    Math.max(Math.ceil(filteredProducts.length / productsPerPage), 1),
  );
  const products = filteredProducts.slice(0, loadedPageCount * productsPerPage);
  const filterData = await getSearchFilterData(allProducts);
  const pathname = "/busca";
  const normalizedParams = normalizeSearchParams(rawSearchParams);
  const preservedSortParams = { ...normalizedParams };
  delete preservedSortParams.ordem;
  delete preservedSortParams.pagina;
  const loadMoreParams = {
    ...normalizedParams,
    pagina: String(loadedPageCount + 1),
  };
  const filterValues: CategoryFilterValues = {
    minPrice,
    maxPrice,
    availability,
    promotion,
    brand,
    category,
    order: currentOrder,
    attributes: Object.fromEntries(
      Object.entries(selectedAttributes).map(([key, value]) => [
        key,
        value.join(","),
      ]),
    ),
  };
  const clearHref = query ? `/busca?q=${encodeURIComponent(query)}` : "/busca";

  return (
    <>
      <Header />
      <main className="py-6 sm:py-8 lg:py-10">
        <Container>
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <li>
                <Link href="/" className="hover:text-[#ff6a00]">Home</Link>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden="true">›</span>
                <span className="text-slate-800" aria-current="page">Busca</span>
              </li>
            </ol>
          </nav>

          {!query ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
              <h1 className="text-2xl font-bold text-[#0c2d72]">Busca de produtos</h1>
              <p className="mt-2 text-slate-600">
                Digite um termo no campo de pesquisa para encontrar produtos.
              </p>
            </div>
          ) : null}

          {query ? (
            <div className="mt-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-4">
              <div className="hidden lg:block">
                <CategoryFilters
                  key={`desktop-${JSON.stringify(filterValues)}`}
                  mode="desktop"
                  pathname={pathname}
                  values={filterValues}
                  filterData={filterData}
                  preservedParams={{ q: query }}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-col gap-4 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-[#0c2d72]">
                      Resultados para “{query}”
                    </h1>
                    <p className="sr-only" aria-live="polite">
                      {filteredProducts.length} produtos encontrados
                    </p>
                  </div>
                  {!searchFailed ? (
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <CategoryFilters
                        key={`mobile-${JSON.stringify(filterValues)}`}
                        mode="mobile"
                        pathname={pathname}
                        values={filterValues}
                        filterData={filterData}
                        preservedParams={{ q: query }}
                      />
                      <CategorySort
                        key={currentOrder}
                        pathname={pathname}
                        currentOrder={currentOrder}
                        preservedParams={preservedSortParams}
                        showRelevance
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-6">
                  {searchFailed ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                      <h2 className="text-lg font-semibold text-[#0c2d72]">
                        Não foi possível pesquisar agora
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        Tente novamente em alguns instantes.
                      </p>
                    </div>
                  ) : products.length > 0 ? (
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
                            regularPrice={product.onSale ? product.regularPrice : undefined}
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
                      {products.length < filteredProducts.length ? (
                        <div className="mt-8 flex justify-center">
                          <LoadMoreButton pathname={pathname} searchParams={loadMoreParams} />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                      <h2 className="text-lg font-semibold text-[#0c2d72]">
                        Nenhum produto encontrado
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        Tente outro termo ou remova os filtros selecionados.
                      </p>
                      <Link
                        href={clearHref}
                        className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-[#ff6a00] px-5 text-sm font-semibold text-white"
                      >
                        Limpar filtros
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <RecentlyViewedProducts />
        </Container>
      </main>
    </>
  );
}
