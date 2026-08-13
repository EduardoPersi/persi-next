import type { Metadata } from "next";
import { DirectCheckoutRedirect } from "@/components/Checkout/DirectCheckoutRedirect";
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

// O checkout continua aberto para convidados (sem exigir login) — o
// checkout nativo do WooCommerce, para onde o cliente é enviado, coleta
// contato e endereço diretamente, sem etapas prévias aqui no Next.js.
export default function CheckoutPage() {
  return (
    <>
      <CheckoutHeader />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          <h1 className="sr-only">Finalizar compra</h1>
          <DirectCheckoutRedirect />
        </Container>
      </main>
    </>
  );
}
