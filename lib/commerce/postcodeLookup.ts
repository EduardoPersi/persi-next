import type { CartAddress } from "../../types/cart.ts";

// Consulta de CEP em dois provedores: BrasilAPI primeiro, ViaCEP como reserva.
// Módulo puro (recebe o `fetch`), para testar a ordem, o fallback e o cache
// sem rede. O serviço server-only em services/shipping/postcode.ts liga isto
// ao `fetch` real.

export const POSTCODE_PROVIDER_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function toAddress(
  digits: string,
  fields: {
    street?: unknown;
    neighborhood?: unknown;
    city?: unknown;
    state?: unknown;
    postcode?: unknown;
  },
): CartAddress | undefined {
  const city = readText(fields.city);
  const state = readText(fields.state);
  if (!city || !state) return undefined;
  return {
    address1: readText(fields.street),
    address2: readText(fields.neighborhood),
    city,
    state,
    // Sempre "00000-000": é o formato que o ViaCEP devolvia e que o restante
    // do código já recebia (a BrasilAPI manda só os 8 dígitos).
    postcode: `${digits.slice(0, 5)}-${digits.slice(5)}`,
    country: "BR",
  };
}

export function parseBrasilApiPostcode(
  digits: string,
  body: unknown,
): CartAddress | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as Record<string, unknown>;
  return toAddress(digits, {
    street: data.street,
    neighborhood: data.neighborhood,
    city: data.city,
    state: data.state,
    postcode: data.cep,
  });
}

export function parseViaCepPostcode(
  digits: string,
  body: unknown,
): CartAddress | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as Record<string, unknown>;
  if (data.erro === true || data.erro === "true") return undefined;
  return toAddress(digits, {
    street: data.logradouro,
    neighborhood: data.bairro,
    city: data.localidade,
    state: data.uf,
    postcode: data.cep,
  });
}

async function requestProvider(
  fetchImpl: FetchLike,
  url: string,
  parse: (digits: string, body: unknown) => CartAddress | undefined,
  digits: string,
): Promise<CartAddress | undefined> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(POSTCODE_PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    return parse(digits, await response.json());
  } catch {
    return undefined;
  }
}

export async function lookupPostcodeWithFallback(
  postcode: string,
  fetchImpl: FetchLike,
): Promise<CartAddress | undefined> {
  const digits = postcode.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;

  const fromBrasilApi = await requestProvider(
    fetchImpl,
    `https://brasilapi.com.br/api/cep/v1/${digits}`,
    parseBrasilApiPostcode,
    digits,
  );
  if (fromBrasilApi) return fromBrasilApi;

  return requestProvider(
    fetchImpl,
    `https://viacep.com.br/ws/${digits}/json/`,
    parseViaCepPostcode,
    digits,
  );
}

// Cache em memória de CEPs encontrados (endereço de um CEP quase não muda).
// Só guarda sucesso: "não encontrado" pode ser uma falha passageira dos dois
// provedores e não deve ficar preso por 24 h.
export function createPostcodeCache(now: () => number = Date.now) {
  const entries = new Map<string, { address: CartAddress; expiresAt: number }>();

  return {
    get(digits: string): CartAddress | undefined {
      const entry = entries.get(digits);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(digits);
        return undefined;
      }
      return entry.address;
    },
    set(digits: string, address: CartAddress) {
      if (entries.size >= CACHE_MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(digits, { address, expiresAt: now() + CACHE_TTL_MS });
    },
  };
}
