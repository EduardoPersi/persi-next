import "server-only";

import {
  createPostcodeCache,
  lookupPostcodeWithFallback,
} from "@/lib/commerce/postcodeLookup";
import type { CartAddress } from "@/types/cart";

const postcodeCache = createPostcodeCache();

// BrasilAPI primeiro, ViaCEP como reserva, 3 s por provedor e cache em
// memória dos CEPs encontrados (ver lib/commerce/postcodeLookup.ts).
export async function lookupBrazilianPostcode(
  postcode: string,
): Promise<CartAddress | undefined> {
  const digits = postcode.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return undefined;

  const cached = postcodeCache.get(digits);
  if (cached) return cached;

  const address = await lookupPostcodeWithFallback(digits, (url, init) =>
    fetch(url, { ...init, cache: "no-store" }),
  );
  if (address) postcodeCache.set(digits, address);
  return address;
}
