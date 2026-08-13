import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  buildCheckoutTransferPayload,
  CheckoutTransferError,
  createCheckoutTransfer,
  getCheckoutTransferConfig,
} from "@/lib/commerce/checkoutTransfer";
import { getCartTokenCookieOptions } from "@/lib/commerce/cartResponsePolicy";
import { getAuthoritativeCheckoutItems } from "@/services/checkout/headlessCheckout";
import { CartServiceError, getCart } from "@/services/woocommerce/cart";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

// Sem página própria de propósito: visitar /checkout já dispara a
// transferência e redireciona (303) direto para o checkout nativo do
// WooCommerce, sem passar por nenhuma tela renderizada pelo Next.js. O
// botão "Finalizar compra" precisa pular o interceptador global de cliques
// (RouteTransitionProvider) com data-route-transition-skip — senão o
// router.push() do Next tentaria fazer uma navegação client-side para uma
// rota que não tem page.tsx nenhuma.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  let activeCartToken = cookieStore.get(CART_TOKEN_COOKIE)?.value;
  const cartUrl = new URL("/carrinho", request.url);

  try {
    const configuration = getCheckoutTransferConfig();

    if (!activeCartToken) {
      return NextResponse.redirect(cartUrl, 303);
    }

    const cartResult = await getCart(activeCartToken);
    activeCartToken = cartResult.cartToken ?? activeCartToken;

    const items = await getAuthoritativeCheckoutItems(cartResult.cart);
    const payload = buildCheckoutTransferPayload(items, undefined, activeCartToken);
    const transfer = await createCheckoutTransfer(payload, configuration);

    const response = NextResponse.redirect(transfer.transferUrl, 303);
    response.cookies.set(
      CART_TOKEN_COOKIE,
      activeCartToken,
      getCartTokenCookieOptions(process.env.NODE_ENV === "production"),
    );
    return response;
  } catch (error) {
    const diagnosticCode =
      error instanceof CheckoutTransferError
        ? error.diagnosticCode
        : error instanceof CartServiceError
          ? "CHECKOUT_CART_FETCH_FAILED"
          : "CHECKOUT_RESPONSE_INVALID";
    console.error("[checkout-redirect]", { code: diagnosticCode });

    const response = NextResponse.redirect(cartUrl, 303);
    if (activeCartToken) {
      response.cookies.set(
        CART_TOKEN_COOKIE,
        activeCartToken,
        getCartTokenCookieOptions(process.env.NODE_ENV === "production"),
      );
    }
    return response;
  }
}
