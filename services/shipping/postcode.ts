import "server-only";

import type { CartAddress } from "@/types/cart";

const POSTCODE_LOOKUP_TIMEOUT_MS = 4_000;

interface ViaCepResponse {
  bairro?: unknown;
  cep?: unknown;
  erro?: unknown;
  localidade?: unknown;
  logradouro?: unknown;
  uf?: unknown;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

export async function lookupBrazilianPostcode(
  postcode: string,
): Promise<CartAddress | undefined> {
  const digits = postcode.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(POSTCODE_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;

    const body = (await response.json()) as ViaCepResponse;
    if (!body || body.erro === true) return undefined;

    const city = readText(body.localidade);
    const state = readText(body.uf);
    if (!city || !state) return undefined;

    return {
      address1: readText(body.logradouro),
      address2: readText(body.bairro),
      city,
      state,
      postcode: readText(body.cep) ?? digits,
      country: "BR",
    };
  } catch {
    return undefined;
  }
}
