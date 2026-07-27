import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildCheckoutTransferPayload,
  CheckoutTransferError,
  createCheckoutTransfer,
  getCheckoutTransferConfig,
} from "@/lib/commerce/checkoutTransfer";
import {
  getCartTokenCookieOptions,
  getPrivateCartHeaders,
} from "@/lib/commerce/cartResponsePolicy";
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

export async function POST() {
  let activeCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  try {
    const configuration = getCheckoutTransferConfig();

    if (!activeCartToken) {
      throw new CheckoutTransferError(422, "Cart token is missing");
    }

    const cartResult = await getCart(activeCartToken);
    activeCartToken = cartResult.cartToken ?? activeCartToken;

    const items = await getAuthoritativeCheckoutItems(cartResult.cart);
    const payload = buildCheckoutTransferPayload(items);
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
    return createPrivateResponse(
      { message: GENERIC_ERROR_MESSAGE },
      getErrorStatus(error),
      activeCartToken,
    );
  }
}
