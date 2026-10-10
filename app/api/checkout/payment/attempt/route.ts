import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { getPrivateCartHeaders } from "@/lib/commerce/cartResponsePolicy";
import { buildAttemptResponseBody, resolveAttemptAccess } from "@/lib/commerce/attemptResponse";
import { getCheckoutAttempt } from "@/lib/commerce/checkoutAttempt";
import { resolveAttemptOutcome, type AttemptOutcome } from "@/lib/commerce/paymentPolling";
import { createTrustedIpRateLimiter } from "@/lib/network/rateLimit";
import { getServerAccountSession } from "@/services/account/serverSession";
import { getCardChargeStatus as getMercadoPagoCardChargeStatus } from "@/services/payments/mercadopago/charge";
import { getCardChargeStatus as getPagBankCardChargeStatus } from "@/services/payments/pagbank/charge";
import { categorizeCardStatus, categorizeMercadoPagoCardStatus } from "@/services/payments/reconcile";
import { getOrderById } from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// Em que pé está uma tentativa de pagamento, pela MESMA chave de idempotência.
// Só leitura: nunca cria cobrança, nunca troca a chave, nunca reconcilia pedido
// (quem reconcilia é a página de confirmação, para onde o cliente é levado
// quando a cobrança existe). Usada pelo checkout enquanto o pagamento está
// "em processamento" (409). Contrato: lib/commerce/paymentPolling.ts.
//
// Resposta: { outcome: "processing" | "created" | "declined" | "not_found", confirmationUrl }.
// Qualquer dúvida (sem pedido, sem autorização, erro de consulta) vira
// "processing": o cliente continua esperando, nada é liberado.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Uma aba consulta a cada 5 s (12 por minuto); 60 por minuto por IP dá folga para
// várias abas. O IP vem só de `cf-connecting-ip`; sem ele, o limite não se aplica
// e o aviso sai no log com a rota (mesma regra do pagamento).
const rateLimiter = createTrustedIpRateLimiter(60 * 1000, 60, "/api/checkout/payment/attempt");

function respond(body: object, status = 200) {
  const response = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}

const processing = () => respond({ outcome: "processing" satisfies AttemptOutcome });

// Consulta de leitura ao gateway do cartão: recusado (true), não recusado
// (false) ou sem resposta (null).
async function isCardDeclined(method: string, reference: string): Promise<boolean | null> {
  try {
    if (method === "mercadopago_card") {
      const charge = await getMercadoPagoCardChargeStatus(reference);
      return categorizeMercadoPagoCardStatus(charge.status) === "failed";
    }
    if (method.startsWith("pagbank_")) {
      const charge = await getPagBankCardChargeStatus(reference);
      return categorizeCardStatus(charge.status) === "failed";
    }
    return false;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (rateLimiter.isLimited(request.headers)) {
    return respond({ message: "Muitas consultas." }, 429);
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!UUID.test(key)) return respond({ message: "Parâmetros inválidos." }, 400);

  try {
    let attempt;
    try {
      attempt = await getCheckoutAttempt(key);
    } catch (error) {
      // O plugin responde 404 quando a chave nunca foi reservada (o envio não
      // chegou a existir): seguro liberar. Qualquer outro erro é dúvida.
      if (error instanceof Error && error.message.endsWith("(404)")) {
        return respond({ outcome: "not_found" satisfies AttemptOutcome });
      }
      throw error;
    }
    if (!attempt?.order_id) return processing();

    // Só quem criou o pedido consulta (mesma regra da rota de status). Quem recarregou
    // a página no meio do pagamento pode estar com o Cart-Token antigo (a resposta com o
    // cookie novo se perdeu): a posse da chave da tentativa, num pedido de menos de 30
    // minutos, vale como segunda prova, SÓ para devolver o desfecho (e o número do
    // pedido). Nunca devolve cookie nem token, e a página do pedido segue exigindo o
    // Cart-Token ou a conta.
    const order = await getOrderById(Number(attempt.order_id));
    const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
    const session = await getServerAccountSession();
    const access = resolveAttemptAccess({
      order,
      cartToken,
      sessionEmail: session?.customer.email,
      key,
      nowMs: Date.now(),
    });
    if (access === "none") return processing();

    const cardDeclined = attempt.provider_reference
      ? await isCardDeclined(attempt.payment_method, attempt.provider_reference)
      : null;
    const outcome = resolveAttemptOutcome(attempt, cardDeclined, order.status);
    return respond(buildAttemptResponseBody({ outcome, access, key, orderId: order.id }));
  } catch {
    return processing();
  }
}
