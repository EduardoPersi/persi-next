import { Suspense } from "react";
import { BrandCarouselLazy } from "@/components/Brand/BrandCarouselLazy";
import { HomeCategoryCarouselLazy } from "@/components/Category/HomeCategoryCarouselLazy";
import { Header } from "@/components/Header/Header";
import { HeroBanner } from "@/components/HeroBanner/HeroBanner";
import { ExpertAdviceSection } from "@/components/home/ExpertAdviceSection";
import { ExpertAdviceSkeleton } from "@/components/home/ExpertAdviceSkeleton";
import { HomeBenefits } from "@/components/home/HomeBenefits";
import { InstagramFeed } from "@/components/home/InstagramFeed";
import { InstagramSkeleton } from "@/components/home/InstagramSkeleton";
import { FlashDeals } from "@/components/FlashDeals/FlashDeals";
import { NewArrivalsCarouselLazy } from "@/components/Product/NewArrivalsCarouselLazy";
import { ProductGrid } from "@/components/Product/ProductGrid";
import { ProductGridSkeleton } from "@/components/Product/ProductGridSkeleton";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import { getAllProductBrands } from "@/services/woocommerce/brands";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getProducts } from "@/services/woocommerce/products";

const HIDDEN_CATEGORY_SLUGS = new Set([
  "sem-categoria",
  "uncategorized",
]);

export default async function Home() {
  const [allCategories, allBrands, newArrivals] = await Promise.all([
    getAllProductCategories().catch(() => []),
    getAllProductBrands().catch(() => []),
    getProducts({ perPage: 10, order: "desc", orderby: "date" }).catch(
      () => [],
    ),
  ]);
  const mainCategories = allCategories
    .filter(
      (category) =>
        category.parent === 0 &&
        (category.count ?? 0) > 0 &&
        !HIDDEN_CATEGORY_SLUGS.has(category.slug),
    )
    .sort((first, second) =>
      first.name.localeCompare(second.name, "pt-BR"),
    );
  const brands = allBrands
    .filter((brand) => brand.count > 0)
    .sort(
      (first, second) =>
        second.count - first.count ||
        first.name.localeCompare(second.name, "pt-BR"),
    )
    .map((brand) => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      count: brand.count,
      image: brand.image
        ? {
            src: brand.image.src,
            alt: brand.image.alt || `Logo da marca ${brand.name}`,
          }
        : undefined,
    }));
  return (
    <>
      <Header />

      <main className="bg-background">
        <div className="relative px-2 pb-4 pt-2 sm:px-0 sm:pb-0 sm:pt-0">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1/2 bg-primary sm:hidden" />
          <div className="relative">
            <HeroBanner />
          </div>
        </div>

      <section className="hidden border-b border-slate-200 bg-background py-6 sm:block">
        <Container>
          <HomeBenefits />
        </Container>
      </section>

      {mainCategories.length > 0 ? (
        <section className="bg-background py-8 sm:py-10">
          <Container>
            <HomeCategoryCarouselLazy categories={mainCategories} />
          </Container>
        </section>
      ) : null}

      {newArrivals.length > 0 ? (
        <section className="bg-background pb-8 sm:pb-10">
          <Container>
            <NewArrivalsCarouselLazy products={newArrivals} />
          </Container>
        </section>
      ) : null}

      <section className="bg-background py-10 sm:py-12">
        <Container>
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-primary">
              Produtos em destaque
            </h2>
            <p className="mt-1 text-sm text-muted">
              Confira alguns produtos selecionados para você.
            </p>
          </div>

          <Suspense fallback={<ProductGridSkeleton />}>
            <ProductGrid />
          </Suspense>
        </Container>
      </section>

      <section className="bg-background py-8 sm:py-10">
        <Container>
          <Suspense fallback={null}>
            <FlashDeals context={{ type: "home" }} />
          </Suspense>
        </Container>
      </section>

      <h1 className="sr-only">
        Persi Materiais — Materiais de construção, elétrica, hidráulica e
        ferramentas em Jundiaí e região
      </h1>

      <section className="bg-background pb-10">
        <Container>
          <BrandCarouselLazy
            brands={brands}
            pathname="/busca"
          />
          <Suspense fallback={<InstagramSkeleton />}>
            <InstagramFeed />
          </Suspense>
          <RecentlyViewedProducts />

          <Suspense fallback={<ExpertAdviceSkeleton />}>
            <ExpertAdviceSection />
          </Suspense>
        </Container>
      </section>
      </main>
    </>
  );
}
