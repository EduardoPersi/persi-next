import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import {
  getCartTokenCookieOptions,
  getPrivateCartHeaders,
} from "@/lib/commerce/cartResponsePolicy";
import { CheckoutTransferError } from "@/lib/commerce/checkoutTransfer";
import { moneyToNumber } from "@/lib/formatting/money";
import { paymentInitiationSchema } from "@/lib/validation/payments";
import { createBoletoCharge } from "@/services/payments/inter/boleto";
import { createPixCharge } from "@/services/payments/inter/pix";
import { InterPaymentError } from "@/services/payments/inter/errors";
import { createCardCharge } from "@/services/payments/pagbank/charge";
import { PagBankPaymentError } from "@/services/payments/pagbank/errors";
import { getAuthoritativeCheckoutItems } from "@/services/checkout/headlessCheckout";
import { CartServiceError, getCart } from "@/services/woocommerce/cart";
import {
  attachPaymentReference,
  createPendingOrder,
  findOrderByIdempotencyKey,
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

function createPrivateResponse(
  body: object,
  status: number,
  cartToken?: string,
) {
  const response = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    response.headers.set(name, value);
  }
  if (cartToken) {
    response.cookies.set(
      CART_TOKEN_COOKIE,
      cartToken,
      getCartTokenCookieOptions(process.env.NODE_ENV === "production"),
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

    const cartResult = await getCart(activeCartToken);
    activeCartToken = cartResult.cartToken ?? activeCartToken;
    const cart = cartResult.cart;

    const items = await getAuthoritativeCheckoutItems(cart);
    const billingAddress = requireCompleteAddress(cart.billingAddress);
    const shippingAddress = cart.needsShipping
      ? requireCompleteAddress(cart.shippingAddress ?? cart.billingAddress)
      : billingAddress;
    const amount = moneyToNumber(cart.totals.price);
    if (amount <= 0) {
      throw new CheckoutTransferError(422, "Total do pedido inválido");
    }

    const paymentMethod: PersiPaymentMethod = input.method;
    const existingOrder = await findOrderByIdempotencyKey(input.idempotencyKey);

    if (existingOrder?.metaData._persi_payment_reference) {
      const result: PaymentInitiationResult = {
        alreadyInitiated: true,
        method: paymentMethod,
        orderId: existingOrder.id,
      };
      return createPrivateResponse(result, 200, activeCartToken);
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
      }));

    const payerName = `${billingAddress.firstName} ${billingAddress.lastName}`.trim();

    let result: PaymentInitiationResult;

    if (input.method === "inter_pix") {
      const charge = await createPixCharge({
        txid: input.idempotencyKey.replace(/-/g, ""),
        amount,
        payerDocument: input.document,
        payerName,
        description: `Pedido ${order.id}`,
      });
      await attachPaymentReference(order.id, { provider: "inter", externalId: charge.txid });
      result = {
        method: "inter_pix",
        orderId: order.id,
        txid: charge.txid,
        qrCodeCopyPaste: charge.qrCodeCopyPaste,
        qrCodeImageBase64: charge.qrCodeImageBase64,
        expiresAt: charge.expiresAt,
      };
    } else if (input.method === "inter_boleto") {
      const charge = await createBoletoCharge({
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
      result = {
        method: "inter_boleto",
        orderId: order.id,
        requestCode: charge.requestCode,
        digitableLine: charge.digitableLine,
        barcode: charge.barcode,
        dueDate: charge.dueDate,
      };
    } else {
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
      result = {
        method: input.method,
        orderId: order.id,
        chargeId: charge.chargeId,
        status: charge.status,
      };
    }

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
    return createPrivateResponse(
      { message: GENERIC_ERROR_MESSAGE },
      status,
      activeCartToken,
    );
  }
}
