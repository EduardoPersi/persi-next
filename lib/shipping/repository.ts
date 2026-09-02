import "server-only";

import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import { priceLists, prices, productVariants } from "@/lib/db/schema";
import type { QuoteItemRepository, VariantPriceData, VariantShippingData } from "./validators/quoteRequest";

/**
 * Implementação real (Supabase/Drizzle) de QuoteItemRepository. Mantida
 * separada dos validators para que a lógica de resolução de itens continue
 * testável sem banco (ver tests/shippingCoreQuote.test.mjs).
 */
export function createSupabaseQuoteItemRepository(): QuoteItemRepository {
  const db = getDatabase();

  return {
    async findVariants(variantIds: string[]): Promise<VariantShippingData[]> {
      if (variantIds.length === 0) return [];
      return db
        .select({
          id: productVariants.id,
          status: productVariants.status,
          weightValue: productVariants.weightValue,
          weightUnitCode: productVariants.weightUnitCode,
          widthValue: productVariants.widthValue,
          heightValue: productVariants.heightValue,
          lengthValue: productVariants.lengthValue,
          dimensionUnitCode: productVariants.dimensionUnitCode,
        })
        .from(productVariants)
        .where(inArray(productVariants.id, variantIds));
    },

    async findActivePrices(variantIds: string[]): Promise<VariantPriceData[]> {
      if (variantIds.length === 0) return [];
      const now = new Date();
      const rows = await db
        .select({
          variantId: prices.productVariantId,
          listAmountMinor: prices.listAmountMinor,
          saleAmountMinor: prices.saleAmountMinor,
          priority: priceLists.priority,
          validFrom: prices.validFrom,
        })
        .from(prices)
        .innerJoin(priceLists, eq(prices.priceListId, priceLists.id))
        .where(
          and(
            inArray(prices.productVariantId, variantIds),
            eq(prices.status, "active"),
            eq(priceLists.status, "active"),
            lte(prices.validFrom, now),
            or(isNull(prices.validTo), gt(prices.validTo, now)),
          ),
        );

      // Uma variante pode ter preço em mais de uma lista; preferimos a de
      // menor `priority` e, em empate, a vigência mais recente.
      const bestByVariant = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const current = bestByVariant.get(row.variantId);
        const isBetter =
          !current ||
          row.priority < current.priority ||
          (row.priority === current.priority && row.validFrom > current.validFrom);
        if (isBetter) bestByVariant.set(row.variantId, row);
      }

      return [...bestByVariant.values()].map((row) => ({
        variantId: row.variantId,
        listAmountMinor: row.listAmountMinor,
        saleAmountMinor: row.saleAmountMinor,
      }));
    },
  };
}
