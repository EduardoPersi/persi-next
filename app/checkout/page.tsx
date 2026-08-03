import type { Metadata } from "next";
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
          <h1 className="sr-only">Finalizar compra</h1>
          <CheckoutPageClient />
        </Container>
      </main>
    </>
  );
}
