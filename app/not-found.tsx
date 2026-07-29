import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, CircleHelp, SearchX } from "lucide-react";
import { HomeCategoryCarousel } from "@/components/Category/HomeCategoryCarousel";
import { Header } from "@/components/Header/Header";
import { ProductSearch } from "@/components/Header/ProductSearch";
import {
  NotFoundNavigationActions,
  NotFoundWhatsAppAction,
} from "@/components/NotFound/NotFoundActions";
import { NotFoundProducts } from "@/components/NotFound/NotFoundProducts";
import { ProductGridSkeleton } from "@/components/Product/ProductGridSkeleton";
import { RecentlyViewedProducts } from "@/components/Product/RecentlyViewedProducts";
import { Container } from "@/components/UI/Container";
import { getAllProductCategories } from "@/services/woocommerce/categories";
import type { ProductCategory } from "@/types/category";

export const metadata: Metadata = {
  title: "Página não encontrada | Persi Materiais",
  description:
    "A página solicitada não foi encontrada. Continue navegando pela Persi Materiais e encontre produtos de hidráulica, elétrica, ferramentas, impermeabilização e muito mais.",
  robots: {
    index: false,
    follow: true,
  },
};

const FEATURED_CATEGORY_NAMES = [
  "hidráulica",
  "elétrica",
  "impermeabilização",
  "ferramentas",
  "bombas",
  "iluminação",
];

const QUICK_LINKS = [
  { href: "/busca?promocao=sim", label: "Ofertas" },
  { href: "/promocoes", label: "Promoções" },
  { href: "/busca?ordem=recentes", label: "Novidades" },
  { href: "/busca", label: "Marcas" },
  { href: "/duvidas-frequentes", label: "Central de Ajuda" },
];

function normalizeCategoryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function selectFeaturedCategories(categories: ProductCategory[]) {
  const byName = new Map(
    categories.map((category) => [
      normalizeCategoryName(category.name),
      category,
    ]),
  );

  return FEATURED_CATEGORY_NAMES.map((name) =>
    byName.get(normalizeCategoryName(name)),
  ).filter(
    (category): category is ProductCategory => category !== undefined,
  );
}

export default async function NotFound() {
  const categories = await getAllProductCategories().catch(() => []);
  const featuredCategories = selectFeaturedCategories(categories);

  return (
    <>
      <Header />
      <main className="bg-slate-50 pb-12 sm:pb-16">
        <Container>
          <nav
            className="flex items-center gap-2 py-4 text-sm text-slate-600"
            aria-label="Breadcrumb"
          >
            <Link
              href="/"
              className="rounded-sm font-medium text-[#0c2d72] hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
            >
              Home
            </Link>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span aria-current="page">Página não encontrada</span>
          </nav>

          <section
            className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm transition-[opacity,transform] duration-500 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none sm:px-8 sm:py-10 lg:px-12"
            aria-labelledby="not-found-title"
          >
            <div
              className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#0c2d72]/10 text-[#0c2d72] sm:h-28 sm:w-28"
              aria-hidden="true"
            >
              <SearchX className="h-14 w-14 sm:h-16 sm:w-16" />
            </div>
            <h1
              id="not-found-title"
              className="mt-5 text-3xl font-bold text-[#0c2d72] sm:text-4xl"
            >
              Página não encontrada
            </h1>
            <div className="mx-auto mt-4 max-w-2xl space-y-2 text-sm leading-6 text-slate-600 sm:text-base">
              <p>Não encontramos a página que você está procurando.</p>
              <p>
                Ela pode ter sido removida, renomeada ou o endereço informado
                está incorreto.
              </p>
              <p>
                Mas não se preocupe. Aproveite para continuar navegando pela
                Persi.
              </p>
            </div>

            <div className="mx-auto mt-7 max-w-2xl">
              <NotFoundNavigationActions />
            </div>

            <div className="mx-auto mt-8 max-w-2xl">
              <p className="mb-3 text-sm font-semibold text-[#0c2d72]">
                O que você está procurando?
              </p>
              <div className="rounded-xl bg-[#0c2d72] p-3 sm:p-4">
                <ProductSearch variant="desktop" />
                <ProductSearch variant="mobile" />
              </div>
            </div>
          </section>

          <section
            className="mt-10 transition-[opacity,transform] duration-500 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none sm:mt-12"
            aria-labelledby="best-sellers-title"
          >
            <h2
              id="best-sellers-title"
              className="text-2xl font-bold text-[#0c2d72]"
            >
              Produtos mais vendidos
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Produtos em destaque para você continuar comprando.
            </p>
            <Suspense fallback={<ProductGridSkeleton />}>
              <NotFoundProducts />
            </Suspense>
          </section>

          {featuredCategories.length > 0 ? (
            <section
              className="mt-10 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-[opacity,transform] duration-500 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none sm:mt-12 sm:p-7"
              aria-labelledby="featured-categories-title"
            >
              <h2
                id="featured-categories-title"
                className="text-2xl font-bold text-[#0c2d72]"
              >
                Navegue pelas principais categorias
              </h2>
              <div className="[&_#home-categories-title]:sr-only [&_a]:after:mt-1 [&_a]:after:text-sm [&_a]:after:text-[#ff6a00] [&_a]:after:content-['→']">
                <HomeCategoryCarousel categories={featuredCategories} />
              </div>
            </section>
          ) : null}

          <RecentlyViewedProducts
            title="Últimos produtos vistos"
            sectionId="not-found-recently-viewed-title"
          />

          <section
            className="mt-10 rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm transition-[opacity,transform] duration-500 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none sm:mt-12 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:p-7"
            aria-labelledby="help-title"
          >
            <div className="text-center sm:text-left">
              <CircleHelp
                className="mx-auto h-9 w-9 text-emerald-700 sm:mx-0"
                aria-hidden="true"
              />
              <h2
                id="help-title"
                className="mt-2 text-xl font-bold text-[#0c2d72]"
              >
                Precisa de ajuda?
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Nossa equipe pode ajudar você a encontrar exatamente o produto
                que procura.
              </p>
            </div>
            <div className="mt-5 shrink-0 sm:mt-0">
              <NotFoundWhatsAppAction />
            </div>
          </section>

          <nav
            className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm"
            aria-label="Sugestões rápidas"
          >
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="font-semibold text-[#0c2d72] underline-offset-4 hover:text-[#ff6a00] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </Container>
      </main>
    </>
  );
}
