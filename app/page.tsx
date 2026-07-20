import { Suspense } from "react";
import { BrandCarousel } from "@/components/Brand/BrandCarousel";
import { HomeCategoryCarousel } from "@/components/Category/HomeCategoryCarousel";
import { Header } from "@/components/Header/Header";
import { HeroBanner } from "@/components/HeroBanner/HeroBanner";
import { InstagramFeed } from "@/components/Instagram/InstagramFeed";
import { ProductGrid } from "@/components/Product/ProductGrid";
import { ProductGridSkeleton } from "@/components/Product/ProductGridSkeleton";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import { getAllProductBrands } from "@/services/woocommerce/brands";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import { getInstagramMedia } from "@/services/instagram/media";

const HIDDEN_CATEGORY_SLUGS = new Set([
  "sem-categoria",
  "uncategorized",
]);

export default async function Home() {
  const [allCategories, allBrands, instagramMedia] = await Promise.all([
    getAllProductCategories().catch(() => []),
    getAllProductBrands().catch(() => []),
    getInstagramMedia(),
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
  const instagramPosts = instagramMedia.map(
    ({ id, caption, mediaType, permalink, timestamp }) => ({
      id,
      caption,
      mediaType,
      permalink,
      timestamp,
    }),
  );

  return (
    <>
      <Header />

      <HeroBanner />

      {mainCategories.length > 0 ? (
        <section className="bg-white py-8 sm:py-10">
          <Container>
            <HomeCategoryCarousel categories={mainCategories} />
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
            pathname="/categoria/todos"
          />
          <InstagramFeed posts={instagramPosts} />
          <RecentlyViewedProducts />
        </Container>
      </section>
    </>
  );
}
