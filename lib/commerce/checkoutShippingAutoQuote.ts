import { normalizePostcode } from "./shippingCalculator.ts";

export interface AutoQuoteInput {
  // CEP que está no formulário (qualquer máscara).
  postcode: string;
  // Endereço completo: nesse caso quem cota é a atualização de endereço
  // inteira (CheckoutShippingPlaceholder.updateAddress), não esta cotação.
  addressComplete: boolean;
  // CEP e quantidade de opções que o carrinho do servidor já tem.
  cartPostcode: string | undefined;
  cartRateCount: number;
  // Último CEP já cotado automaticamente nesta tela (só uma vez por CEP).
  lastQuotedPostcode: string;
}

// Cotação automática só pelo CEP: vale quando o checkout abre (ou chega na
// etapa de entrega) com um CEP de 8 dígitos já preenchido — endereço da
// conta, rascunho ou link `?cep=` — e o endereço ainda não está completo
// (falta número ou destinatário), então a atualização completa não roda.
export function shouldAutoQuotePostcode({
  postcode,
  addressComplete,
  cartPostcode,
  cartRateCount,
  lastQuotedPostcode,
}: AutoQuoteInput): boolean {
  const digits = normalizePostcode(postcode);
  if (digits.length !== 8) return false;
  if (addressComplete) return false;
  if (lastQuotedPostcode === digits) return false;
  const cartHasThisQuote =
    normalizePostcode(cartPostcode ?? "") === digits && cartRateCount > 0;
  return !cartHasThisQuote;
}

// As opções que estão no carrinho valem para o que está no formulário?
export function cartRatesMatchPostcode(
  postcode: string,
  cartPostcode: string | undefined,
  cartRateCount: number,
): boolean {
  const digits = normalizePostcode(postcode);
  return (
    digits.length === 8 &&
    cartRateCount > 0 &&
    normalizePostcode(cartPostcode ?? "") === digits
  );
}
