import { NextResponse } from "next/server";
import { getPrivateCartHeaders } from "@/lib/commerce/cartResponsePolicy";
import {
  addItemToCart,
  CartServiceError,
  getCart,
  updateCartShippingPostcode,
} from "@/services/woocommerce/cart";
import { lookupBrazilianPostcode } from "@/services/shipping/postcode";
import { productShippingQuoteSchema } from "../shipping-request";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function response(body: Record<string, unknown>, status = 200) {
  const result = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    result.headers.set(name, value);
  }
  return result;
}

export async function POST(request: Request) {
  if (exceedsRequestLimit(request)) {
    return response(
      { message: "Os dados enviados excedem o tamanho permitido." },
      413,
    );
  }

  const parsed = productShippingQuoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return response({ message: "Produto, quantidade ou CEP inválido." }, 400);
  }

  try {
    const destinationLookup = lookupBrazilianPostcode(parsed.data.postcode);
    const temporaryCart = await getCart();
    if (!temporaryCart.cartToken) {
      return response(
        { message: "Não foi possível iniciar o cálculo de frete." },
        503,
      );
    }

    const withProduct = await addItemToCart(
      {
        productId: parsed.data.variationId ?? parsed.data.productId,
        quantity: parsed.data.quantity,
        variation: parsed.data.variation,
      },
      temporaryCart.cartToken,
    );
    const activeToken = withProduct.cartToken ?? temporaryCart.cartToken;
    const quoted = await updateCartShippingPostcode(
      parsed.data.postcode,
      activeToken,
    );
    const destination = await destinationLookup;

    return response({
      shippingPackages: quoted.cart.shippingPackages,
      destination,
    });
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;
    const message =
      status === 400 || status === 409
        ? "Este produto não está disponível para o CEP informado."
        : status === 504
          ? "O cálculo demorou mais que o esperado. Tente novamente."
          : "Não foi possível calcular o frete. Tente novamente.";
    return response({ message }, status);
  }
}
