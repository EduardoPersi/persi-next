import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/network/rateLimit";
import { lookupBrazilianPostcode } from "@/services/shipping/postcode";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const rateLimiter = createRateLimiter(60 * 1000, 30);

// Resolve um CEP em endereço (rua/bairro/cidade/UF): BrasilAPI com ViaCEP de
// reserva. Sem efeito colateral no carrinho. Resposta: `{ address }`, com
// `address: null` quando o CEP não é encontrado (mesmo formato de
// POST /api/shipping/postcode).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ cep: string }> },
) {
  if (rateLimiter.isLimited(request.headers)) {
    return NextResponse.json(
      { message: "Muitas consultas em sequência. Aguarde um instante." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const { cep } = await params;
  const digits = cep.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) {
    return NextResponse.json(
      { message: "Informe um CEP válido." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const address = await lookupBrazilianPostcode(digits);
  return NextResponse.json(
    { address: address ?? null },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
