import { Suspense } from "react";
import { BrandCarousel } from "@/components/Brand/BrandCarousel";
import { HomeCategoryCarousel } from "@/components/Category/HomeCategoryCarousel";
import { Header } from "@/components/Header/Header";
import { HeroBanner } from "@/components/HeroBanner/HeroBanner";
import { ExpertAdviceSection } from "@/components/home/ExpertAdviceSection";
import { ExpertAdviceSkeleton } from "@/components/home/ExpertAdviceSkeleton";
import { HomeBenefits } from "@/components/home/HomeBenefits";
import { InstagramFeed } from "@/components/home/InstagramFeed";
import { InstagramSkeleton } from "@/components/home/InstagramSkeleton";
import { NewArrivalsCarousel } from "@/components/Product/NewArrivalsCarousel";
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

      <HeroBanner />

      <section className="border-b border-slate-200 bg-white py-6">
        <Container>
          <HomeBenefits />
        </Container>
      </section>

      {mainCategories.length > 0 ? (
        <section className="bg-white py-8 sm:py-10">
          <Container>
            <HomeCategoryCarousel categories={mainCategories} />
          </Container>
        </section>
      ) : null}

      {newArrivals.length > 0 ? (
        <section className="bg-white pb-8 sm:pb-10">
          <Container>
            <NewArrivalsCarousel products={newArrivals} />
          </Container>
        </section>
      ) : null}

      <section className="bg-slate-50 py-10 sm:py-12">
        <Container>
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-[#0c2d72]">
              Produtos em destaque
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Confira alguns produtos selecionados para você.
            </p>
          </div>

          <Suspense fallback={<ProductGridSkeleton />}>
            <ProductGrid />
          </Suspense>
        </Container>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-10">
        <h1 className="text-3xl font-bold text-[#0c2d72]">
          Persi Materiais
        </h1>

        <p className="mt-3 text-slate-600">
          Nova loja em desenvolvimento — Revisão 0.1
        </p>
      </main>

      <section className="bg-white pb-10">
        <Container>
          <BrandCarousel
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
    </>
  );
}
