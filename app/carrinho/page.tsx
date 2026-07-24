import type { Metadata } from "next";
import Link from "next/link";
import { CartPage } from "@/components/Cart/CartPage";
import { Header } from "@/components/Header/Header";
import { Container } from "@/components/UI/Container";

export const metadata: Metadata = {
  title: "Carrinho | Persi Materiais",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CartRoute() {
  return (
    <>
      <Header />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <ol className="flex items-center gap-2">
              <li>
                <Link href="/" className="hover:text-[#ff6a00]">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page">Carrinho</li>
            </ol>
          </nav>
          <h1 className="mb-5 mt-3 text-2xl font-bold text-[#0c2d72] sm:mb-6 sm:mt-4 sm:text-3xl">
            Seu carrinho
          </h1>
          <CartPage />
        </Container>
      </main>
    </>
  );
}
