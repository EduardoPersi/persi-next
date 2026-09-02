import "server-only";

import type { ShippingQuoteRequest, ShippingQuoteResult } from "../types";

/**
 * Porta que qualquer transportadora/provider de frete deve implementar.
 * Nenhum código fora de lib/shipping/providers/<provider> deve conhecer
 * detalhes de autenticação, payload ou base URL de um provider específico.
 */
export interface ShippingProvider {
  readonly id: string;
  getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuoteResult>;
}
