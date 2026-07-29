import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleHelp, PackageSearch } from "lucide-react";
import { Header } from "@/components/Header/Header";
import { ProductSearch } from "@/components/Header/ProductSearch";
import {
  NotFoundHelpActions,
  NotFoundNavigationActions,
} from "@/components/NotFound/NotFoundActions";
import { ProductGrid } from "@/components/Product/ProductGrid";
import { ProductGridSkeleton } from "@/components/Product/ProductGridSkeleton";
import { Container } from "@/components/UI/Container";

export const metadata: Metadata = {
  title: "Página não encontrada | Persi Materiais",
  description:
    "A página solicitada não foi encontrada. Utilize nossa busca para localizar produtos de elétrica, hidráulica, ferramentas e materiais de construção.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="bg-slate-50">
        <Container size="md" className="py-10 sm:py-14 lg:py-16">
          <section
            className="mx-auto max-w-[900px] rounded-xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm sm:px-8 sm:py-10 lg:px-12"
            aria-labelledby="not-found-title"
          >
            <div
              className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#0c2d72]/10 text-[#0c2d72] sm:h-28 sm:w-28"
              aria-hidden="true"
            >
              <PackageSearch className="h-14 w-14 sm:h-16 sm:w-16" />
            </div>

            <p className="mt-5 text-6xl font-bold tracking-tight text-[#ff6a00] sm:text-7xl">
              404
            </p>
            <h1
              id="not-found-title"
              className="mt-3 text-2xl font-bold text-[#0c2d72] sm:text-3xl"
            >
              Página não encontrada
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              A página que você tentou acessar não existe, foi removida ou mudou
              de endereço.
            </p>

            <div className="mx-auto mt-6 max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-4 text-left sm:p-5">
              <p className="font-semibold text-slate-800">Você pode:</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600 sm:text-base">
                <li>pesquisar um produto</li>
                <li>navegar pelas categorias</li>
                <li>voltar para a página inicial</li>
              </ul>
            </div>

            <div className="mt-7">
              <NotFoundNavigationActions />
            </div>

            <div className="mx-auto mt-8 max-w-2xl">
              <p className="mb-3 text-sm font-semibold text-[#0c2d72]">
                Pesquise no catálogo da Persi
              </p>
              <div className="rounded-xl bg-[#0c2d72] p-3 sm:p-4">
                <ProductSearch variant="desktop" />
                <ProductSearch variant="mobile" />
              </div>
            </div>
          </section>

          <section
            className="mx-auto mt-10 max-w-[900px]"
            aria-labelledby="featured-products-title"
          >
            <div className="mb-5 text-center">
              <h2
                id="featured-products-title"
                className="text-2xl font-bold text-[#0c2d72]"
              >
                Produtos em destaque
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Confira algumas opções selecionadas para você.
              </p>
            </div>
            <Suspense fallback={<ProductGridSkeleton />}>
              <ProductGrid />
            </Suspense>
          </section>

          <section
            className="mx-auto mt-10 max-w-[900px] rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm sm:p-7"
            aria-labelledby="help-title"
          >
            <CircleHelp
              className="mx-auto h-9 w-9 text-[#ff6a00]"
              aria-hidden="true"
            />
            <h2
              id="help-title"
              className="mt-2 text-xl font-bold text-[#0c2d72]"
            >
              Precisa de ajuda?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Nossa equipe está pronta para ajudar você a encontrar o material
              certo.
            </p>
            <div className="mx-auto mt-5 max-w-lg">
              <NotFoundHelpActions />
            </div>
          </section>
        </Container>
      </main>
    </>
  );
}
