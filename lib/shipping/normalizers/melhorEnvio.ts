import type { ShippingQuote, ShippingQuoteWarning } from "../types";

interface MelhorEnvioDeliveryRange {
  min?: unknown;
  max?: unknown;
}

interface MelhorEnvioCompany {
  id?: unknown;
  name?: unknown;
}

/** Forma crua de /api/v2/me/shipment/calculate — ver docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos. */
export interface MelhorEnvioRawQuote {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  custom_price?: unknown;
  currency?: unknown;
  delivery_time?: unknown;
  custom_delivery_time?: unknown;
  delivery_range?: MelhorEnvioDeliveryRange;
  custom_delivery_range?: MelhorEnvioDeliveryRange;
  company?: MelhorEnvioCompany;
  error?: unknown;
}

/**
 * "id" de uma cotação Melhor Envio que, no histórico do plugin WooCommerce,
 * não aceitava valor declarado (seguro) — ver auditoria do plugin, seção 3.
 * Mantido como dado de referência, não como verdade absoluta: deve ser
 * reconfirmado contra a conta real do Melhor Envio antes de produção.
 */
export const KNOWN_NO_INSURANCE_SERVICE_IDS = new Set([1, 2, 17]);

function parseDecimalToMinorUnits(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = (fraction + "00").slice(0, 2);
  return Number(whole) * 100 + Number(cents);
}

function readPositiveInt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Normaliza a resposta bruta do Melhor Envio para o contrato interno
 * ShippingQuote. Nunca repassa o objeto do provider como está (AGENTS.md
 * §19.5) e nunca inventa prazo/preço quando o campo não vem preenchido —
 * nesse caso a cotação individual é descartada com um warning, o restante da
 * resposta segue normalmente.
 */
export function normalizeMelhorEnvioQuotes(
  raw: unknown,
  now: Date,
  ttlMs: number,
): { quotes: ShippingQuote[]; warnings: ShippingQuoteWarning[] } {
  // A própria auditoria do plugin documentou um caso real em que a API
  // retorna um único objeto em vez de array — normalizamos aqui também.
  const entries: MelhorEnvioRawQuote[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "name" in raw
      ? [raw as MelhorEnvioRawQuote]
      : [];

  const quotes: ShippingQuote[] = [];
  const warnings: ShippingQuoteWarning[] = [];
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  for (const entry of entries) {
    const carrierName = typeof entry.company?.name === "string" ? entry.company.name : "Transportadora";

    if (typeof entry.error === "string" && entry.error.length > 0) {
      warnings.push({ code: "CARRIER_UNAVAILABLE", carrier: carrierName, message: entry.error });
      continue;
    }

    const serviceCode = readPositiveInt(entry.id);
    const priceMinor = parseDecimalToMinorUnits(entry.custom_price ?? entry.price);
    const originalPriceMinor = parseDecimalToMinorUnits(entry.price) ?? priceMinor;
    const estimatedDays =
      readPositiveInt(entry.custom_delivery_time) ?? readPositiveInt(entry.delivery_time);
    const serviceName = typeof entry.name === "string" ? entry.name : null;

    if (serviceCode === null || priceMinor === null || originalPriceMinor === null || estimatedDays === null || !serviceName) {
      warnings.push({
        code: "CARRIER_UNAVAILABLE",
        carrier: carrierName,
        message: "Resposta do provider incompleta para esta opção.",
      });
      continue;
    }

    quotes.push({
      quoteId: crypto.randomUUID(),
      provider: "melhor_envio",
      carrier: carrierName,
      serviceCode: String(serviceCode),
      serviceName,
      priceMinor,
      originalPriceMinor,
      currency: "BRL",
      estimatedDays,
      expiresAt,
    });
  }

  return { quotes, warnings };
}
