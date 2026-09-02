import { NextResponse } from "next/server";
import { buildQuoteCacheKey, createShippingQuoteCacheRepository } from "@/lib/shipping/cache";
import { ShippingProviderError, ShippingValidationError } from "@/lib/shipping/core/errors";
import { getMelhorEnvioConfig, isMelhorEnvioEnabled } from "@/lib/shipping/providers/melhor-envio/config";
import { createMelhorEnvioProvider } from "@/lib/shipping/providers/melhor-envio/provider";
import { createSupabaseQuoteItemRepository } from "@/lib/shipping/repository";
import {
  assertHasQuotableItems,
  resolveQuoteItems,
  shippingQuoteRequestSchema,
} from "@/lib/shipping/validators/quoteRequest";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" };
const MAX_REQUEST_BYTES = 16_384;

function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...extra }, { status, headers: NO_STORE_HEADERS });
}

function exceedsRequestLimit(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return true;
  const parsed = Number(contentLength);
  return !Number.isFinite(parsed) || parsed > MAX_REQUEST_BYTES;
}

// Nunca cachear "nenhuma transportadora disponível" pelo mesmo TTL de uma
// cotação real — evita esconder uma transportadora que volte a ficar
// disponível pouco depois.
const EMPTY_QUOTE_CACHE_TTL_MS = 5 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isMelhorEnvioEnabled()) {
    return jsonError(503, "Cotação de frete temporariamente indisponível.");
  }

  if (exceedsRequestLimit(request)) {
    return jsonError(413, "Os dados enviados excedem o tamanho permitido.");
  }

  const parsed = shippingQuoteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "Informe um CEP e ao menos um item válido.");
  }

  const repository = createSupabaseQuoteItemRepository();
  // peso, dimensão e preço vêm sempre daqui — nunca do corpo da requisição
  // (ver lib/shipping/validators/quoteRequest.ts).
  const resolved = await resolveQuoteItems(repository, parsed.data.items);

  try {
    assertHasQuotableItems(resolved);
  } catch (error) {
    if (error instanceof ShippingValidationError) {
      return jsonError(422, error.message, { warnings: resolved.warnings });
    }
    throw error;
  }

  const config = getMelhorEnvioConfig();
  const cacheKey = buildQuoteCacheKey(
    "melhor_envio",
    parsed.data.postcode,
    resolved.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
  );
  const cache = createShippingQuoteCacheRepository();

  const cached = await cache.read(cacheKey, new Date());
  if (cached) {
    return NextResponse.json({ ...cached, warnings: resolved.warnings, cached: true }, { headers: NO_STORE_HEADERS });
  }

  try {
    const provider = createMelhorEnvioProvider(config);
    const result = await provider.getQuotes({
      originPostcode: config.originPostcode,
      destinationPostcode: parsed.data.postcode,
      items: resolved.items,
    });

    const ttl = result.quotes.length === 0 ? EMPTY_QUOTE_CACHE_TTL_MS : config.quoteCacheTtlMs;
    await cache.write(cacheKey, "melhor_envio", parsed.data.postcode, result, new Date(Date.now() + ttl));

    return NextResponse.json(
      { ...result, warnings: [...resolved.warnings, ...result.warnings], cached: false },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return mapProviderError(error);
  }
}

function mapProviderError(error: unknown): NextResponse {
  if (!(error instanceof ShippingProviderError)) {
    console.error("[shipping-quote]", { code: "UNKNOWN" });
    return jsonError(500, "Não foi possível calcular o frete agora.");
  }

  // Nenhum detalhe interno do provider (status HTTP cru, corpo de erro) vai
  // ao cliente — só o código estável, seguindo docs/database/04-security.md.
  console.error("[shipping-quote]", { code: error.code, providerStatus: error.status });

  switch (error.code) {
    case "TIMEOUT":
      return jsonError(504, "O cálculo do frete demorou mais que o esperado. Tente novamente.");
    case "AUTH":
    case "UNAVAILABLE":
      return jsonError(503, "Não foi possível calcular o frete agora. Tente novamente em instantes.");
    case "INVALID_REQUEST":
    case "NO_SERVICE":
    default:
      return jsonError(422, "Não foi possível calcular o frete para este endereço.");
  }
}

