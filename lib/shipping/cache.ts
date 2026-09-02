import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import { shippingQuoteCache } from "@/lib/db/schema";
import type { ShippingProviderId, ShippingQuoteResult } from "./types";

/**
 * Chave determinística por provider + CEP destino + itens (id+quantidade).
 * NOTA: ainda não incorpora "perfil logístico" — o schema do catálogo não
 * tem essa coluna hoje (confirmado na auditoria de orders/payments), então
 * não há risco de colisão agora. Quando shipping profile existir, a chave
 * precisa incluí-lo também.
 */
export function buildQuoteCacheKey(
  provider: ShippingProviderId,
  destinationPostcode: string,
  items: Array<{ variantId: string; quantity: number }>,
): string {
  const normalizedItems = [...items]
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((item) => `${item.variantId}:${item.quantity}`)
    .join("|");
  const raw = `${provider}|${destinationPostcode}|${normalizedItems}`;
  return createHash("sha256").update(raw).digest("hex");
}

export interface QuoteCacheRepository {
  read(cacheKey: string, now: Date): Promise<ShippingQuoteResult | null>;
  write(
    cacheKey: string,
    provider: ShippingProviderId,
    destinationPostcode: string,
    result: ShippingQuoteResult,
    expiresAt: Date,
  ): Promise<void>;
}

export function createShippingQuoteCacheRepository(): QuoteCacheRepository {
  const db = getDatabase();

  return {
    async read(cacheKey, now) {
      const [row] = await db
        .select()
        .from(shippingQuoteCache)
        .where(eq(shippingQuoteCache.cacheKey, cacheKey))
        .limit(1);
      if (!row) return null;
      if (row.expiresAt.getTime() <= now.getTime()) return null;
      return row.response as ShippingQuoteResult;
    },

    async write(cacheKey, provider, destinationPostcode, result, expiresAt) {
      await db
        .insert(shippingQuoteCache)
        .values({ cacheKey, provider, destinationPostcode, response: result, expiresAt })
        .onConflictDoUpdate({
          target: shippingQuoteCache.cacheKey,
          set: { response: result, expiresAt, destinationPostcode },
        });
    },
  };
}
