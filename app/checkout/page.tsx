import type { Metadata } from "next";
import Link from "next/link";
import { CheckoutPageClient } from "@/components/Checkout/CheckoutPageClient";
import { CheckoutHeader } from "@/components/Header/CheckoutHeader";
import { Container } from "@/components/UI/Container";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Finalizar compra | Persi Materiais",
  description: "Revise seus dados e seu pedido na Persi Materiais.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CheckoutPage() {
  return (
    <>
      <CheckoutHeader />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="hover:text-secondary">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li>
                <Link href="/carrinho" className="hover:text-secondary">
                  Carrinho
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page">Finalizar compra</li>
            </ol>
          </nav>
          <h1 className="mb-5 mt-3 text-2xl text-[#0c2d72] sm:mb-6 sm:mt-4 sm:text-3xl">
            Finalizar compra
          </h1>
          <CheckoutPageClient />
        </Container>
      </main>
    </>
  );
}
