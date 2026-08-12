import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  buildCheckoutTransferPayload,
  CheckoutTransferError,
  createCheckoutTransfer,
  getCheckoutTransferConfig,
} from "@/lib/commerce/checkoutTransfer";
import { mapCheckoutFormToWooAddress } from "@/lib/commerce/checkoutAddress";
import {
  getCartTokenCookieOptions,
  getPrivateCartHeaders,
} from "@/lib/commerce/cartResponsePolicy";
import { checkoutSchema } from "@/lib/validation/checkout";
import { getAuthoritativeCheckoutItems } from "@/services/checkout/headlessCheckout";
import {
  CartServiceError,
  getCart,
} from "@/services/woocommerce/cart";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GENERIC_ERROR_MESSAGE =
  "Não foi possível preparar o checkout. Tente novamente.";

function createPrivateResponse(
  body: Record<string, unknown>,
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

function getErrorStatus(error: unknown): number {
  if (error instanceof CheckoutTransferError) return error.status;
  if (error instanceof CartServiceError) {
    return error.status === 401 || error.status === 409
      ? error.status
      : error.status === 503
        ? 503
        : 502;
  }
  return 500;
}

function getDiagnosticCode(error: unknown): string {
  if (error instanceof CheckoutTransferError) return error.diagnosticCode;
  if (error instanceof CartServiceError) return "CHECKOUT_CART_FETCH_FAILED";
  return "CHECKOUT_RESPONSE_INVALID";
}

export async function POST(request: NextRequest) {
  let activeCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  try {
    const configuration = getCheckoutTransferConfig();

    if (!activeCartToken) {
      throw new CheckoutTransferError(422, "Cart token is missing");
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      throw new CheckoutTransferError(422, "Invalid checkout data");
    }

    const parsedForm = checkoutSchema.safeParse(requestBody);
    if (!parsedForm.success) {
      throw new CheckoutTransferError(422, "Invalid checkout data");
    }

    const customer = mapCheckoutFormToWooAddress(parsedForm.data);

    const cartResult = await getCart(activeCartToken);
    activeCartToken = cartResult.cartToken ?? activeCartToken;

    const items = await getAuthoritativeCheckoutItems(cartResult.cart);
    const payload = buildCheckoutTransferPayload(items, customer);
    const transfer = await createCheckoutTransfer(payload, configuration);

    return createPrivateResponse(
      {
        transferUrl: transfer.transferUrl,
        expiresAt: transfer.expiresAt,
      },
      200,
      activeCartToken,
    );
  } catch (error) {
    const status = getErrorStatus(error);
    console.error("[checkout-transfer]", {
      code: getDiagnosticCode(error),
      status,
    });
    return createPrivateResponse(
      { message: GENERIC_ERROR_MESSAGE },
      status,
      activeCartToken,
    );
  }
}
