import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { BadgeCheck } from "lucide-react";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { PendingPaymentConfirmation } from "@/components/Checkout/PendingPaymentConfirmation";
import { CheckoutHeader } from "@/components/Header/CheckoutHeader";
import { Container } from "@/components/UI/Container";
import { getCheckoutAttempt, reconcileCheckoutAttempt } from "@/lib/commerce/checkoutAttempt";
import { formatBrazilianDocument, formatBrazilianPhone } from "@/lib/formatting/personalData";
import { getServerAccountSession } from "@/services/account/serverSession";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { getPixCharge, getPixChargeStatus } from "@/services/payments/inter/pix";
import { getCardChargeStatus } from "@/services/payments/pagbank/charge";
import {
  categorizeBoletoStatus,
  categorizeCardStatus,
  categorizePixStatus,
  reconcilePaymentReference,
  type PaymentStatusCategory,
} from "@/services/payments/reconcile";
import { isAuthorizedForOrderStatus } from "@/services/payments/statusAuthorization";
import {
  categorizeOrderStatus,
  findOrderByPaymentReference,
  getOrderById,
  getOrderConfirmationDetails,
  type OrderConfirmationDetails,
  type PaymentProvider,
  type WooCommerceOrder,
} from "@/services/woocommerce/orders";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

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
    attempt?: string;
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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  inter_pix: "Pix - Banco Inter",
  inter_boleto: "Boleto - Banco Inter",
  pagbank_card: "Cartão de crédito - PagBank",
  pagbank_apple_pay: "Apple Pay - PagBank",
  pagbank_google_pay: "Google Pay - PagBank",
};

type RecoveryData =
  | { method: "inter_pix"; reference: string; copyPaste: string; qrCodeImageBase64: string; expiresAt: string }
  | { method: "inter_boleto"; reference: string; digitableLine: string; barcode: string; dueDate: string };

type ResolvedStatus = {
  category: PaymentStatusCategory;
  order: WooCommerceOrder;
  recovery?: RecoveryData;
};

async function resolveInterOrPagBankStatus(
  provider: string | undefined,
  reference: string | undefined,
): Promise<ResolvedStatus | null> {
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
      return { category: categorizePixStatus(charge), order };
    }
    if (provider === "inter_boleto") {
      const charge = await getBoletoChargeStatus(reference);
      return { category: categorizeBoletoStatus(charge.status), order };
    }
    const charge = await getCardChargeStatus(reference);
    return { category: categorizeCardStatus(charge.status), order };
  } catch {
    return null;
  }
}

// Checkout nativo do WooCommerce: o pedido já sai criado com o status final
// do gateway (não existe "reference" de um provedor externo pra reconsultar
// — o próprio WooCommerce é a fonte de verdade aqui), então só falta a mesma
// checagem de autorização (nunca confiar só na query string) antes de
// mostrar qualquer detalhe.
async function resolveWooCommerceStatus(
  orderId: string | undefined,
): Promise<ResolvedStatus | null> {
  if (!orderId) return null;
  const numericOrderId = Number(orderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId < 1) return null;

  try {
    const order = await getOrderById(numericOrderId);

    const requestCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
    const session = await getServerAccountSession();
    if (!isAuthorizedForOrderStatus(order, requestCartToken, session?.customer.email)) {
      return null;
    }

    return { category: categorizeOrderStatus(order.status), order };
  } catch {
    return null;
  }
}

async function resolveStatus(params: {
  provider?: string;
  reference?: string;
  orderId?: string;
  attempt?: string;
}): Promise<ResolvedStatus | null> {
  if (params.attempt && /^[0-9a-f-]{36}$/i.test(params.attempt)) {
    try {
      const attempt = await getCheckoutAttempt(params.attempt);
      if (!attempt.order_id || !attempt.provider_reference) return null;
      const order = await getOrderById(Number(attempt.order_id));
      const requestCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
      const session = await getServerAccountSession();
      if (!isAuthorizedForOrderStatus(order, requestCartToken, session?.customer.email)) return null;

      if (attempt.payment_method === "inter_pix") {
        const charge = await getPixCharge(attempt.provider_reference);
        const category = categorizePixStatus(charge);
        await reconcilePaymentReference("inter", attempt.provider_reference, category);
        if (category !== "pending") {
          await reconcileCheckoutAttempt(
            attempt.provider_reference,
            category === "paid" ? "PAYMENT_CONFIRMED" : "PAYMENT_FAILED",
          ).catch(() => undefined);
        }
        return {
          category,
          order,
          recovery: {
            method: "inter_pix",
            reference: charge.txid,
            copyPaste: charge.qrCodeCopyPaste,
            qrCodeImageBase64: charge.qrCodeImageBase64,
            expiresAt: charge.expiresAt,
          },
        };
      }
      if (attempt.payment_method === "inter_boleto") {
        const charge = await getBoletoChargeStatus(attempt.provider_reference);
        const category = categorizeBoletoStatus(charge.status);
        await reconcilePaymentReference("inter", attempt.provider_reference, category);
        if (category !== "pending") {
          await reconcileCheckoutAttempt(
            attempt.provider_reference,
            category === "paid" ? "PAYMENT_CONFIRMED" : "PAYMENT_FAILED",
          ).catch(() => undefined);
        }
        return {
          category,
          order,
          recovery: {
            method: "inter_boleto",
            reference: charge.requestCode,
            digitableLine: charge.digitableLine,
            barcode: charge.barcode,
            dueDate: charge.dueDate,
          },
        };
      }
      if (attempt.payment_method.startsWith("pagbank_")) {
        const charge = await getCardChargeStatus(attempt.provider_reference);
        return { category: categorizeCardStatus(charge.status), order };
      }
      return null;
    } catch {
      return null;
    }
  }
  if (params.provider === "woocommerce") {
    return resolveWooCommerceStatus(params.orderId);
  }
  return resolveInterOrPagBankStatus(params.provider, params.reference);
}

function formatMoney(value: string, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
    Number(value) || 0,
  );
}

function PaidConfirmation({
  provider,
  details,
}: {
  provider: string;
  details: OrderConfirmationDetails;
}) {
  const paymentMethodLabel =
    provider === "woocommerce"
      ? details.paymentMethodLabel || "Forma de pagamento confirmada"
      : (PAYMENT_METHOD_LABELS[provider] ?? provider);

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <BadgeCheck
          className="mx-auto h-14 w-14 text-emerald-600"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <h1 className="mt-3 text-xl font-bold text-emerald-700 sm:text-2xl">
          Pagamento confirmado!
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-600">
          O pagamento do pedido <strong>#{details.id}</strong> foi aprovado! A
          partir de agora vamos prosseguir com as etapas do seu pedido.
          Enviaremos notificações em cada etapa, não se preocupe.
        </p>
        <Link
          href={`/minha-conta/pedidos/${details.id}`}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Ver pedido
        </Link>
        <Link
          href="/"
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-primary px-6 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:ml-3 sm:mt-5"
        >
          Continuar comprando
        </Link>

        <dl className="mt-6 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              E-mail
            </dt>
            <dd className="mt-1 text-sm text-slate-800">{details.email}</dd>
          </div>
          {details.phone ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Telefone
              </dt>
              <dd className="mt-1 text-sm text-slate-800">
                {formatBrazilianPhone(details.phone)}
              </dd>
            </div>
          ) : null}
          {details.document ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Documento
              </dt>
              <dd className="mt-1 text-sm text-slate-800">
                {formatBrazilianDocument(details.document)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-base font-bold text-[#0c2d72]">Detalhes do pedido</h2>
        <ul className="mt-4 divide-y divide-slate-200">
          {details.items.map((item) => (
            <li key={item.id} className="flex gap-3 py-3 first:pt-0">
              <Image
                src={item.imageSrc || FALLBACK_IMAGE}
                alt={item.name}
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-contain"
              />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <p className="text-sm text-slate-800">
                  {item.name}
                  <span className="text-slate-500"> × {item.quantity}</span>
                </p>
                <strong className="shrink-0 text-sm text-slate-900">
                  {formatMoney(item.total, details.currency)}
                </strong>
              </div>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Subtotal:</dt>
            <dd className="font-semibold text-slate-900">
              {formatMoney(details.itemsSubtotal, details.currency)}
            </dd>
          </div>
          {details.shippingLabel ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Entrega:</dt>
              <dd className="text-right text-slate-900">
                {details.shippingLabel}
                {Number(details.shippingTotal) > 0
                  ? ` (${formatMoney(details.shippingTotal, details.currency)})`
                  : ""}
              </dd>
            </div>
          ) : null}
          {Number(details.discountTotal) > 0 ? (
            <div className="flex justify-between gap-4 text-emerald-700">
              <dt>{details.discountLabel}:</dt>
              <dd>-{formatMoney(details.discountTotal, details.currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-slate-200 pt-3">
            <dt className="font-bold text-slate-900">Total:</dt>
            <dd className="text-base font-bold text-[#0c2d72]">
              {formatMoney(details.total, details.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 pt-1">
            <dt className="font-medium text-emerald-700">Método de pagamento:</dt>
            <dd className="font-medium text-emerald-700">{paymentMethodLabel}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default async function CheckoutConfirmationPage({
  searchParams,
}: ConfirmationPageProps) {
  const params = await searchParams;
  const resolved = await resolveStatus(params);
  const isPaid = resolved?.category === "paid";
  const details = isPaid
    ? await getOrderConfirmationDetails(resolved.order.id).catch(() => null)
    : null;
  const copy = resolved ? STATUS_COPY[resolved.category] : null;
  const pendingResult = resolved?.category === "pending" && resolved.recovery
    ? resolved.recovery.method === "inter_pix"
      ? {
          method: "inter_pix" as const,
          orderId: resolved.order.id,
          amount: Number(resolved.order.total),
          txid: resolved.recovery.reference,
          qrCodeCopyPaste: resolved.recovery.copyPaste,
          qrCodeImageBase64: resolved.recovery.qrCodeImageBase64,
          expiresAt: resolved.recovery.expiresAt,
          checkoutAttemptId: params.attempt ?? "",
          confirmationUrl: `/checkout/confirmacao?attempt=${encodeURIComponent(params.attempt ?? "")}`,
        }
      : {
          method: "inter_boleto" as const,
          orderId: resolved.order.id,
          amount: Number(resolved.order.total),
          requestCode: resolved.recovery.reference,
          digitableLine: resolved.recovery.digitableLine,
          barcode: resolved.recovery.barcode,
          dueDate: resolved.recovery.dueDate,
          checkoutAttemptId: params.attempt ?? "",
          confirmationUrl: `/checkout/confirmacao?attempt=${encodeURIComponent(params.attempt ?? "")}`,
        }
    : null;

  return (
    <>
      <CheckoutHeader centered={isPaid && Boolean(details)} />
      <main className="bg-slate-50 py-5 sm:py-8 lg:py-10">
        <Container>
          {isPaid && details ? (
            <div className="mx-auto max-w-4xl">
              <PaidConfirmation
                provider={params.provider ?? resolved?.order.paymentMethod ?? ""}
                details={details}
              />
            </div>
          ) : pendingResult ? (
            <div className="mx-auto max-w-4xl" aria-live="polite">
              <PendingPaymentConfirmation result={pendingResult} />
            </div>
          ) : (
            <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h1 className="text-2xl text-[#0c2d72] sm:text-3xl">
                {copy?.title ?? "Recebemos o seu pedido"}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {copy?.description ??
                  "Assim que o pagamento for confirmado, você receberá um e-mail com os detalhes do pedido."}
              </p>
              {resolved?.category === "pending" && resolved.recovery?.method === "inter_pix" ? (
                <div className="mt-6 space-y-4">
                  <Image
                    src={`data:image/png;base64,${resolved.recovery.qrCodeImageBase64}`}
                    alt="QR Code para pagamento via Pix"
                    width={280}
                    height={280}
                    unoptimized
                    className="mx-auto rounded-xl border border-slate-200"
                  />
                  <p className="break-all rounded-xl bg-slate-100 p-3 text-xs text-slate-800">
                    {resolved.recovery.copyPaste}
                  </p>
                </div>
              ) : null}
              {resolved?.category === "pending" && resolved.recovery?.method === "inter_boleto" ? (
                <div className="mt-6 space-y-3">
                  {resolved.recovery.digitableLine ? (
                    <p className="break-all rounded-xl bg-slate-100 p-3 text-xs text-slate-800">
                      {resolved.recovery.digitableLine}
                    </p>
                  ) : null}
                  <Link
                    href={`/api/checkout/payment/boleto-pdf?reference=${encodeURIComponent(resolved.recovery.reference)}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-white"
                  >
                    Abrir boleto em PDF
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </Container>
      </main>
    </>
  );
}
