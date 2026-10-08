import type { CartAddress } from "../../types/cart.ts";

/**
 * O que o formulário de endereço faz com a resposta da busca de CEP.
 *
 * Regra: rua, bairro, cidade e UF vêm SEMPRE do CEP novo. Nunca sobra o valor
 * do CEP anterior — "Avenida Paulista, São Paulo" ao lado de um CEP de Itupeva
 * iria para o cálculo do frete e para o pedido.
 *
 * Três resultados possíveis da busca:
 *   - endereço completo (rua + cidade + UF): preenche tudo;
 *   - CEP "geral" de cidade pequena (Itupeva 13295-000: só cidade e UF, sem
 *     rua): preenche cidade e UF, deixa rua e bairro vazios para o cliente
 *     digitar e mostra os campos manuais;
 *   - não encontrado ou falha: deixa tudo vazio e mostra os campos manuais.
 */

/** Os campos que pertencem ao CEP (o número e o complemento são do cliente). */
export const POSTCODE_BOUND_FIELDS = ["addressLine1", "neighborhood", "city", "state"] as const;

export interface AddressFieldsFromLookup {
  addressLine1: string;
  neighborhood: string;
  city: string;
  state: string;
  /** Rua, cidade e UF vieram: dá para mostrar "Enviando para…". */
  resolved: boolean;
  /** Resolvido, mas sem bairro: pede o bairro ao cliente. */
  neighborhoodMissing: boolean;
}

export function addressFieldsFromLookup(
  address: CartAddress | null | undefined,
): AddressFieldsFromLookup {
  // `address2` do serviço de CEP carrega o bairro (não o complemento) — ver
  // services/shipping/postcode.ts.
  const addressLine1 = address?.address1?.trim() ?? "";
  const neighborhood = address?.address2?.trim() ?? "";
  const city = address?.city?.trim() ?? "";
  const state = address?.state?.trim().toUpperCase() ?? "";
  const resolved = Boolean(addressLine1 && city && state);
  return {
    addressLine1,
    neighborhood,
    city,
    state,
    resolved,
    neighborhoodMissing: resolved && !neighborhood,
  };
}
