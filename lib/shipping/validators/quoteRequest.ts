import "server-only";

import { z } from "zod";
import { ShippingValidationError } from "../core/errors";
import type { ShippingPackageItem, ShippingQuoteWarning } from "../types";

export const postcodeSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{8}$/, "CEP inválido."));

export const shippingQuoteRequestSchema = z
  .object({
    postcode: postcodeSchema,
    items: z
      .array(
        z
          .object({
            variantId: z.string().uuid(),
            quantity: z.number().int().positive().max(999),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export type ShippingQuoteRequestInput = z.infer<typeof shippingQuoteRequestSchema>;

/**
 * Dados canônicos de uma variante, lidos do Supabase — nunca aceitos do
 * cliente. weight/width/height/length em string porque `numeric` do Postgres
 * vem como string via Drizzle (evita perda de precisão silenciosa).
 */
export interface VariantShippingData {
  id: string;
  status: string;
  weightValue: string | null;
  weightUnitCode: string | null;
  widthValue: string | null;
  heightValue: string | null;
  lengthValue: string | null;
  dimensionUnitCode: string | null;
}

export interface VariantPriceData {
  variantId: string;
  listAmountMinor: bigint;
  saleAmountMinor: bigint | null;
}

export interface QuoteItemRepository {
  findVariants(variantIds: string[]): Promise<VariantShippingData[]>;
  findActivePrices(variantIds: string[]): Promise<VariantPriceData[]>;
}

const WEIGHT_TO_KG: Record<string, number> = { kg: 1, g: 0.001 };
const DIMENSION_TO_CM: Record<string, number> = { cm: 1, mm: 0.1, m: 100 };

function toPositiveNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Converte peso/dimensão para as unidades exigidas pela API do Melhor Envio
 * (kg/cm). Retorna null quando o dado está ausente OU a unidade não é
 * reconhecida — nos dois casos o item entra como MISSING_DIMENSIONS, nunca
 * com um valor assumido silenciosamente (ver decisão documentada na PR: o
 * plugin legado assumia 15x15x15cm/1kg sem aviso, comportamento que esta
 * implementação deliberadamente não repete).
 */
function convertWeightKg(value: string | null, unitCode: string | null): number | null {
  const numeric = toPositiveNumber(value);
  if (numeric === null) return null;
  const factor = WEIGHT_TO_KG[(unitCode ?? "kg").toLowerCase()];
  return factor === undefined ? null : numeric * factor;
}

function convertDimensionCm(value: string | null, unitCode: string | null): number | null {
  const numeric = toPositiveNumber(value);
  if (numeric === null) return null;
  const factor = DIMENSION_TO_CM[(unitCode ?? "cm").toLowerCase()];
  return factor === undefined ? null : numeric * factor;
}

export interface ResolveQuoteItemsResult {
  items: ShippingPackageItem[];
  warnings: ShippingQuoteWarning[];
}

/**
 * Resolve os itens pedidos contra dados canônicos do Supabase: peso, medidas
 * e preço nunca vêm do payload do cliente (ver AGENTS.md §17.3/§30.2 e o
 * princípio da F.2 — "nunca confiar em preço/peso vindo do browser").
 *
 * Item sem variante ativa, sem medida/peso completos ou sem preço ativo é
 * excluído do cálculo e reportado em `warnings`, sem derrubar os demais itens
 * do carrinho. Se nenhum item sobrar, o chamador deve tratar como erro
 * (nenhum item cotável) — ver app/api/shipping/quote/route.ts.
 */
export async function resolveQuoteItems(
  repository: QuoteItemRepository,
  requestedItems: ShippingQuoteRequestInput["items"],
): Promise<ResolveQuoteItemsResult> {
  const variantIds = [...new Set(requestedItems.map((item) => item.variantId))];
  const [variants, prices] = await Promise.all([
    repository.findVariants(variantIds),
    repository.findActivePrices(variantIds),
  ]);

  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const priceByVariantId = new Map(prices.map((price) => [price.variantId, price]));

  const items: ShippingPackageItem[] = [];
  const warnings: ShippingQuoteWarning[] = [];

  for (const requested of requestedItems) {
    const variant = variantById.get(requested.variantId);
    if (!variant || variant.status !== "active") {
      warnings.push({
        code: "MISSING_DIMENSIONS",
        variantId: requested.variantId,
        message: "Produto indisponível para cotação de frete.",
      });
      continue;
    }

    const weightKg = convertWeightKg(variant.weightValue, variant.weightUnitCode);
    const widthCm = convertDimensionCm(variant.widthValue, variant.dimensionUnitCode);
    const heightCm = convertDimensionCm(variant.heightValue, variant.dimensionUnitCode);
    const lengthCm = convertDimensionCm(variant.lengthValue, variant.dimensionUnitCode);

    if (weightKg === null || widthCm === null || heightCm === null || lengthCm === null) {
      warnings.push({
        code: "MISSING_DIMENSIONS",
        variantId: requested.variantId,
        message: "Peso ou dimensões não cadastrados para este produto.",
      });
      continue;
    }

    const price = priceByVariantId.get(requested.variantId);
    if (!price) {
      warnings.push({
        code: "MISSING_DIMENSIONS",
        variantId: requested.variantId,
        message: "Preço ativo não encontrado para este produto.",
      });
      continue;
    }

    const unitAmountMinor = price.saleAmountMinor ?? price.listAmountMinor;

    items.push({
      variantId: requested.variantId,
      quantity: requested.quantity,
      weightKg,
      widthCm,
      heightCm,
      lengthCm,
      insuranceValueMinor: Number(unitAmountMinor),
    });
  }

  return { items, warnings };
}

export function assertHasQuotableItems(result: ResolveQuoteItemsResult): void {
  if (result.items.length === 0) {
    throw new ShippingValidationError(
      "Nenhum item do pedido pôde ser cotado.",
      result.warnings.map((warning) => warning.message),
    );
  }
}
