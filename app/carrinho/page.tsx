import type { Metadata } from "next";
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
          <h1 className="sr-only">Seu carrinho</h1>
          <CartPage />
        </Container>
      </main>
    </>
  );
}
