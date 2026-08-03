import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { CheckoutHeader } from "@/components/Header/CheckoutHeader";
import { Container } from "@/components/UI/Container";
import { getServerAccountSession } from "@/services/account/serverSession";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { getPixChargeStatus } from "@/services/payments/inter/pix";
import { getCardChargeStatus } from "@/services/payments/pagbank/charge";
import {
  categorizeBoletoStatus,
  categorizeCardStatus,
  categorizePixStatus,
  type PaymentStatusCategory,
} from "@/services/payments/reconcile";
import { isAuthorizedForOrderStatus } from "@/services/payments/statusAuthorization";
import { findOrderByPaymentReference, type PaymentProvider } from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Confirmação do pedido | Persi Materiais",
  robots: { index: false, follow: false },
};

interface ConfirmationPageProps {
  searchParams: Promise<{
    provider?: string;
    reference?: string;
    orderId?: string;
  }>;
}

const STATUS_COPY: Record<PaymentStatusCategory, { title: string; description: string }> = {
  paid: {
    title: "Pagamento confirmado",
    description: "Recebemos a confirmação do seu pagamento. Você vai receber os detalhes do pedido por e-mail.",
  },
  pending: {
    title: "Pagamento em processamento",
    description: "Ainda estamos aguardando a confirmação do pagamento. Isso pode levar alguns minutos.",
  },
  failed: {
    title: "Pagamento não aprovado",
    description: "Não foi possível confirmar este pagamento. Você pode tentar novamente pelo carrinho.",
  },
};

async function resolveStatus(
  provider: string | undefined,
  reference: string | undefined,
): Promise<PaymentStatusCategory | null> {
  if (!provider || !reference) return null;
  if (provider !== "inter_pix" && provider !== "inter_boleto" && provider !== "pagbank_card") {
    return null;
  }

  try {
    // Mesma regra da rota de status (services/payments/statusAuthorization):
    // só resolve/consulta o provedor depois de confirmar que quem pediu
    // esta página tem relação com o pedido dessa reference.
    const paymentProvider: PaymentProvider = provider === "pagbank_card" ? "pagbank" : "inter";
    const order = await findOrderByPaymentReference(paymentProvider, reference);
    if (!order) return null;

    const requestCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
    const session = await getServerAccountSession();
    if (!isAuthorizedForOrderStatus(order, requestCartToken, session?.customer.email)) {
      return null;
    }

    if (provider === "inter_pix") {
      const charge = await getPixChargeStatus(reference);
      return categorizePixStatus(charge);
    }
    if (provider === "inter_boleto") {
      const charge = await getBoletoChargeStatus(reference);
      return categorizeBoletoStatus(charge.status);
    }
    const charge = await getCardChargeStatus(reference);
    return categorizeCardStatus(charge.status);
  } catch {
    return null;
  }
}

export default async function CheckoutConfirmationPage({
  searchParams,
}: ConfirmationPageProps) {
  const params = await searchParams;
  const category = await resolveStatus(params.provider, params.reference);
  const copy = category ? STATUS_COPY[category] : null;

  return (
    <>
      <CheckoutHeader />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl text-[#0c2d72] sm:text-3xl">
              {copy?.title ?? "Recebemos o seu pedido"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {copy?.description ??
                "Assim que o pagamento for confirmado, você receberá um e-mail com os detalhes do pedido."}
            </p>
          </div>
        </Container>
      </main>
    </>
  );
}
