/** Subconjunto de public.external_system que este app efetivamente escreve hoje. */
export type ShippingProviderId = "melhor_envio";

export interface ShippingPackageItem {
  /** product_variants.id (uuid) — nunca um ID numérico do WooCommerce aqui. */
  variantId: string;
  quantity: number;
  weightKg: number;
  widthCm: number;
  heightCm: number;
  lengthCm: number;
  /** Valor declarado (seguro) em minor units BRL, sempre lido do Supabase. */
  insuranceValueMinor: number;
}

export interface ShippingQuoteRequest {
  originPostcode: string;
  destinationPostcode: string;
  items: ShippingPackageItem[];
}

export type ShippingQuoteWarningCode = "MISSING_DIMENSIONS" | "CARRIER_UNAVAILABLE";

export interface ShippingQuoteWarning {
  code: ShippingQuoteWarningCode;
  variantId?: string;
  carrier?: string;
  message: string;
}

export interface ShippingQuote {
  quoteId: string;
  provider: "melhor_envio";
  carrier: string;
  serviceCode: string;
  serviceName: string;
  priceMinor: number;
  originalPriceMinor: number;
  currency: "BRL";
  estimatedDays: number;
  /** Só preenchido quando o provider retorna uma data real — nunca inventado. */
  estimatedDeliveryAt?: string;
  expiresAt: string;
}

export interface ShippingQuoteResult {
  destinationPostcode: string;
  quotes: ShippingQuote[];
  warnings: ShippingQuoteWarning[];
}
