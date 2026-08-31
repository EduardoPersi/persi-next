import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { lookupBrazilianPostcode } from "@/services/shipping/postcode";
import { createRateLimiter } from "@/lib/network/rateLimit";
import { cartShippingQuoteSchema } from "../shipping-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const rateLimiter = createRateLimiter(60 * 1000, 30);

// Rota isolada, sem efeito colateral no carrinho: só resolve um CEP em
// endereço (rua/bairro/cidade/estado) via o mesmo serviço já usado pelo
// cálculo de frete (services/shipping/postcode.ts) — usada pelo
// autopreenchimento de endereço no checkout, que não deve disparar um
// cálculo de frete completo a cada CEP digitado.
export async function POST(request: Request) {
  if (rateLimiter.isLimited(request.headers)) {
    return NextResponse.json(
      { message: "Muitas consultas em sequência. Aguarde um instante." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  if (exceedsRequestLimit(request)) {
    return NextResponse.json(
      { message: "Os dados enviados excedem o tamanho permitido." },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = cartShippingQuoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Informe um CEP válido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const address = await lookupBrazilianPostcode(parsed.data.postcode);

  return NextResponse.json(
    { address: address ?? null },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
