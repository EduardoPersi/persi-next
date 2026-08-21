import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { MIN_BOLETO_AMOUNT } from "@/components/Checkout/paymentMethod";
import { getPublicCheckoutCapabilities } from "@/lib/commerce/checkoutConfig";
import {
  getCartTokenCookieOptions,
  getExpiredCartTokenCookieOptions,
  getPrivateCartHeaders,
} from "@/lib/commerce/cartResponsePolicy";
import { CheckoutTransferError } from "@/lib/commerce/checkoutTransfer";
import { reserveCheckoutAttempt, transitionCheckoutAttempt } from "@/lib/commerce/checkoutAttempt";
import { moneyToNumber } from "@/lib/formatting/money";
import { paymentInitiationSchema } from "@/lib/validation/payments";
import { interPaymentGateway } from "@/services/payments/gateway";
import { InterPaymentError } from "@/services/payments/inter/errors";
import { createCardCharge } from "@/services/payments/pagbank/charge";
import { PagBankPaymentError } from "@/services/payments/pagbank/errors";
import { getServerAccountSession } from "@/services/account/serverSession";
import { getAuthoritativeCheckoutItems } from "@/services/checkout/headlessCheckout";
import { CartServiceError, getCart } from "@/services/woocommerce/cart";
import {
  attachPaymentReference,
  createPendingOrder,
  findOrderByIdempotencyKey,
  markOrderAsFailed,
  WooCommerceRestError,
  type PersiPaymentMethod,
} from "@/services/woocommerce/orders";
import type { CartAddress } from "@/types/cart";
import type { CheckoutStoreAddress } from "@/types/checkout";
import type { PaymentInitiationResult } from "@/types/payments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GENERIC_ERROR_MESSAGE = "Não foi possível iniciar o pagamento. Tente novamente.";

function isAuthorizedStagingDryRun(request: Request): boolean {
  const configured = process.env.CHECKOUT_STAGING_DRY_RUN_SECRET?.trim();
  const received = request.headers.get("x-persi-staging-dry-run")?.trim();
  if (!configured || !received) return false;
  const expectedBuffer = Buffer.from(configured);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function createPrivateResponse(
  body: object,
  status: number,
  cartToken?: string,
  options: { clearCartToken?: boolean } = {},
) {
  const response = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    response.headers.set(name, value);
  }
  const isProduction = process.env.NODE_ENV === "production";
  if (options.clearCartToken) {
    // O pedido já foi criado a partir de uma foto do carrinho (ver
    // getAuthoritativeCheckoutItems) — diferente do checkout nativo do
    // WooCommerce, nada mais esvazia o carrinho sozinho. Sem isso, os
    // mesmos itens continuam aparecendo no carrinho depois da compra.
    response.cookies.set(
      CART_TOKEN_COOKIE,
      "",
      getExpiredCartTokenCookieOptions(isProduction),
    );
  } else if (cartToken) {
    response.cookies.set(
      CART_TOKEN_COOKIE,
      cartToken,
      getCartTokenCookieOptions(isProduction),
    );
  }
  return response;
}

function requireCompleteAddress(
  address: CartAddress | undefined,
): CheckoutStoreAddress {
  if (
    !address?.firstName ||
    !address.lastName ||
    !address.address1 ||
    !address.city ||
    !address.state ||
    !address.postcode
  ) {
    throw new CheckoutTransferError(
      422,
      "Endereço incompleto",
      "CHECKOUT_RESPONSE_INVALID",
    );
  }

  return {
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    state: address.state,
    postcode: address.postcode,
    country: "BR",
    email: address.email,
    phone: address.phone,
  };
}

function getErrorStatus(error: unknown): number {
  if (error instanceof CheckoutTransferError) return error.status;
  if (
    error instanceof CartServiceError ||
    error instanceof WooCommerceRestError ||
    error instanceof InterPaymentError ||
    error instanceof PagBankPaymentError
  ) {
    return error.status === 401 || error.status === 409 || error.status === 422
      ? error.status
      : error.status === 503
        ? 503
        : 502;
  }
  return 500;
}

export async function POST(request: Request) {
  let activeCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  try {
    if (!activeCartToken) {
      throw new CheckoutTransferError(422, "Cart token is missing");
    }
    if (exceedsRequestLimit(request)) {
      throw new CheckoutTransferError(413, "Payload too large");
    }

    const body = await request.json().catch(() => null);
    const parsed = paymentInitiationSchema.safeParse(body);
    if (!parsed.success) {
      throw new CheckoutTransferError(400, "Dados de pagamento inválidos");
    }
    const input = parsed.data;
    if (typeof input.expectedAmount !== "number") {
      throw new CheckoutTransferError(400, "Total esperado ausente.");
    }
    const capabilities = getPublicCheckoutCapabilities();
    const methodEnabled = input.method === "inter_pix"
      ? capabilities.pix
      : input.method === "inter_boleto"
        ? capabilities.boleto
        : capabilities.card;
    if (!methodEnabled) {
      throw new CheckoutTransferError(422, "Forma de pagamento indisponível.");
    }

    const cartResult = await getCart(activeCartToken);
    activeCartToken = cartResult.cartToken ?? activeCartToken;
    const cart = cartResult.cart;

    const items = await getAuthoritativeCheckoutItems(cart);
    const billingAddress = requireCompleteAddress(cart.billingAddress);
    const shippingAddress = cart.needsShipping
      ? requireCompleteAddress(cart.shippingAddress ?? cart.billingAddress)
      : billingAddress;
    const cartAmount = moneyToNumber(cart.totals.price);
    if (cartAmount <= 0) {
      throw new CheckoutTransferError(422, "Total do pedido inválido");
    }
    if (Math.abs(cartAmount - input.expectedAmount) >= 0.01) {
      return createPrivateResponse(
        { code: "CART_CHANGED", message: "O carrinho foi atualizado. Revise os valores antes de continuar.", cart },
        409,
        activeCartToken,
      );
    }

    const paymentMethod: PersiPaymentMethod = input.method;
    const reservation = await reserveCheckoutAttempt(input.idempotencyKey, paymentMethod);
    if (!reservation.acquired) {
      if (reservation.attempt.provider_reference && reservation.attempt.order_id) {
        const result: PaymentInitiationResult = {
          alreadyInitiated: true,
          method: paymentMethod,
          orderId: Number(reservation.attempt.order_id),
          checkoutAttemptId: input.idempotencyKey,
        };
        return createPrivateResponse(result, 200, activeCartToken);
      }
      return createPrivateResponse(
        { code: "CHECKOUT_IN_PROGRESS", message: "Este pedido já está sendo processado. Aguarde alguns segundos." },
        409,
        activeCartToken,
      );
    }
    const leaseToken = reservation.lease_token;
    if (!leaseToken) throw new Error("Checkout lease missing");
    const existingOrder = await findOrderByIdempotencyKey(input.idempotencyKey);

    if (existingOrder?.metaData._persi_payment_reference) {
      const result: PaymentInitiationResult = {
        alreadyInitiated: true,
        method: paymentMethod,
        orderId: existingOrder.id,
        checkoutAttemptId: input.idempotencyKey,
      };
      return createPrivateResponse(result, 200, activeCartToken);
    }

    // Desconto por forma de pagamento (Pix/Boleto): o valor efetivamente
    // cobrado no Banco Inter/PagBank é sempre calculado a partir do total do
    // carrinho (que já inclui frete) menos o desconto — nunca a partir do
    // total do pedido no WooCommerce, que hoje não recebe shipping_lines e
    // por isso não representa o frete. A mesma fee_line é registrada no
    // pedido só para ficar visível no admin/relatórios.
    const amount = cartAmount;
    if (amount <= 0) {
      throw new CheckoutTransferError(422, "Total do pedido inválido");
    }
    if (paymentMethod === "inter_boleto" && amount < MIN_BOLETO_AMOUNT) {
      throw new CheckoutTransferError(
        422,
        `O valor mínimo para pagamento via boleto é R$ ${MIN_BOLETO_AMOUNT.toFixed(2).replace(".", ",")}. Escolha Pix ou cartão para valores menores.`,
      );
    }

    // Sem isso, o pedido fica órfão (sem customer_id) mesmo com o cliente
    // logado, e some da lista "Meus pedidos" — checkout já exige login, então
    // a sessão deveria sempre existir aqui; se por algum motivo não existir,
    // o pedido ainda é criado (como convidado) em vez de falhar o pagamento.
    const session = await getServerAccountSession();
    const selectedShippingRate = cart.needsShipping
      ? cart.shippingPackages
          .flatMap((shippingPackage) => shippingPackage.rates)
          .find((rate) => rate.selected)
      : undefined;
    if (cart.needsShipping && !selectedShippingRate) {
      return createPrivateResponse(
        { code: "SHIPPING_CHANGED", message: "Selecione novamente a forma de entrega." },
        409,
        activeCartToken,
      );
    }

    const order =
      existingOrder ??
      (await createPendingOrder({
        idempotencyKey: input.idempotencyKey,
        items,
        billingAddress,
        shippingAddress,
        paymentMethod,
        customerNote: input.customerNote,
        ownerToken: activeCartToken,
        customerId: session?.customer.id,
        shippingLine: selectedShippingRate?.methodId
          ? {
              name: selectedShippingRate.name,
              amount: moneyToNumber(selectedShippingRate.price),
              methodId: selectedShippingRate.methodId,
            }
          : undefined,
        couponCodes: cart.coupons.map(({ code }) => code),
      }));

    if (reservation.attempt.state === "RESERVED") {
      await transitionCheckoutAttempt({
        checkoutAttemptId: input.idempotencyKey,
        leaseToken,
        from: "RESERVED",
        to: "ORDER_CREATED",
        orderId: order.id,
      });
    }
    let attemptState = reservation.attempt.state;
    if (attemptState === "RESERVED") attemptState = "ORDER_CREATED";

    const authoritativeOrderAmount = Number(order.total);
    if (
      !Number.isFinite(authoritativeOrderAmount) ||
      Math.abs(authoritativeOrderAmount - amount) >= 0.01
    ) {
      await markOrderAsFailed(order, "cancelled").catch(() => undefined);
      return createPrivateResponse(
        { code: "ORDER_TOTAL_MISMATCH", message: "Os valores foram atualizados. Revise o pedido antes de tentar novamente." },
        409,
        activeCartToken,
      );
    }

    // Diagnóstico temporário: não existia nenhum log no caminho de sucesso —
    // só assim dá pra confirmar, quando um pagamento é feito de verdade, qual
    // pedido foi realmente criado/reaproveitado no WooCommerce.
    console.info("[checkout-payment] state", {
      orderId: order.id,
      reused: Boolean(existingOrder),
      checkoutAttemptHash: input.idempotencyKey.replace(/-/g, "").slice(0, 12),
      method: paymentMethod,
      state: "ORDER_CREATED",
    });

    const payerName = `${billingAddress.firstName} ${billingAddress.lastName}`.trim();

    if (isAuthorizedStagingDryRun(request)) {
      return createPrivateResponse(
        {
          code: "STAGING_STOPPED_BEFORE_GATEWAY",
          checkoutAttemptId: input.idempotencyKey,
          orderId: order.id,
        },
        202,
        activeCartToken,
      );
    }

    let result: PaymentInitiationResult;

    if (attemptState === "ORDER_CREATED") {
      await transitionCheckoutAttempt({
        checkoutAttemptId: input.idempotencyKey,
        leaseToken,
        from: "ORDER_CREATED",
        to: "PAYMENT_CREATING",
      });
    }

    if (input.method === "inter_pix") {
      const txid = input.idempotencyKey.replace(/-/g, "");
      let charge;
      try {
        charge = await interPaymentGateway.getPix(txid);
      } catch {
        charge = await interPaymentGateway.createPix({
        txid: input.idempotencyKey.replace(/-/g, ""),
        amount,
        payerDocument: input.document,
        payerName,
        description: `Pedido ${order.id}`,
        });
      }
      await attachPaymentReference(order.id, { provider: "inter", externalId: charge.txid });
      await transitionCheckoutAttempt({ checkoutAttemptId: input.idempotencyKey, leaseToken, from: "PAYMENT_CREATING", to: "PAYMENT_CREATED", providerReference: charge.txid });
      result = {
        method: "inter_pix",
        orderId: order.id,
        amount,
        txid: charge.txid,
        qrCodeCopyPaste: charge.qrCodeCopyPaste,
        qrCodeImageBase64: charge.qrCodeImageBase64,
        expiresAt: charge.expiresAt,
        checkoutAttemptId: input.idempotencyKey,
      };
    } else if (input.method === "inter_boleto") {
      if (attemptState === "PAYMENT_CREATING") {
        throw new CheckoutTransferError(409, "Boleto em reconciliação; uma nova cobrança não será criada.");
      }
      const charge = await interPaymentGateway.createBoleto({
        seuNumero: String(order.id),
        amount,
        payerDocument: input.document,
        payerName,
        billingAddress,
      });
      await attachPaymentReference(order.id, {
        provider: "inter",
        externalId: charge.requestCode,
      });
      await transitionCheckoutAttempt({ checkoutAttemptId: input.idempotencyKey, leaseToken, from: "PAYMENT_CREATING", to: "PAYMENT_CREATED", providerReference: charge.requestCode });
      result = {
        method: "inter_boleto",
        orderId: order.id,
        amount,
        requestCode: charge.requestCode,
        digitableLine: charge.digitableLine,
        barcode: charge.barcode,
        dueDate: charge.dueDate,
        checkoutAttemptId: input.idempotencyKey,
      };
    } else {
      if (attemptState === "PAYMENT_CREATING") {
        throw new CheckoutTransferError(
          409,
          "Pagamento com cartão em reconciliação; uma nova cobrança não será criada.",
        );
      }
      const cardPaymentMethod =
        input.method === "pagbank_card"
          ? "credit_card"
          : input.method === "pagbank_apple_pay"
            ? "apple_pay"
            : "google_pay";
      const cardToken = input.method === "pagbank_card" ? input.cardToken : input.token;

      const charge = await createCardCharge({
        referenceId: String(order.id),
        amount,
        cardToken,
        installments: input.method === "pagbank_card" ? input.installments : 1,
        paymentMethod: cardPaymentMethod,
        holderDocument: input.holderDocument,
        holderName: payerName,
        holderEmail: billingAddress.email ?? "",
      });
      await attachPaymentReference(order.id, {
        provider: "pagbank",
        externalId: charge.chargeId,
      });
      await transitionCheckoutAttempt({ checkoutAttemptId: input.idempotencyKey, leaseToken, from: "PAYMENT_CREATING", to: "PAYMENT_CREATED", providerReference: charge.chargeId });
      result = {
        method: input.method,
        orderId: order.id,
        chargeId: charge.chargeId,
        status: charge.status,
        checkoutAttemptId: input.idempotencyKey,
      };
    }

    await transitionCheckoutAttempt({
      checkoutAttemptId: input.idempotencyKey,
      leaseToken,
      from: "PAYMENT_CREATED",
      to: "PAYMENT_PENDING",
    });

    return createPrivateResponse(result, 201, activeCartToken);
  } catch (error) {
    const status = getErrorStatus(error);
    console.error("[checkout-payment]", {
      status,
      code:
        error instanceof CheckoutTransferError
          ? error.diagnosticCode
          : error instanceof Error
            ? error.name
            : "UNKNOWN",
    });
    // Só passa a mensagem adiante para erros 422 (dado inválido/ação do
    // cliente, ex.: valor abaixo do mínimo do boleto) — nunca para falhas
    // de provedor/servidor (502/503), que continuam com o texto genérico
    // para não vazar detalhe interno.
    const message =
      status === 422 && error instanceof Error && error.message
        ? error.message
        : GENERIC_ERROR_MESSAGE;
    return createPrivateResponse({ message }, status, activeCartToken);
  }
}
