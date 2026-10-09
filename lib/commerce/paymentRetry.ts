/**
 * Nova tentativa de pagamento depois de uma recusa de cartão.
 *
 * A chave de idempotência garante que o MESMO envio nunca cobra duas vezes: o
 * servidor devolve o resultado guardado para a mesma chave. Depois de uma
 * recusa DEFINITIVA, o cliente precisa de uma chave nova para tentar outro
 * cartão (ou Pix/boleto) sem recarregar a página.
 *
 * Regra de ouro: chave nova SÓ na falha definitiva (cartão recusado,
 * `CARD_PAYMENT_DECLINED`, estado PAYMENT_FAILED). Em qualquer outra situação
 * a chave é mantida: processamento ou reconciliação em andamento (409,
 * PAYMENT_CREATING), limite de tentativas (429), erro do servidor ou da rede.
 * Nesses casos o resultado do envio é incerto, e trocar a chave poderia cobrar
 * em dobro.
 *
 * Código puro, sem dependências: o checkout só chama estas funções.
 */

export const CARD_DECLINED_RETRY_MESSAGE =
  "Pagamento não aprovado. Confira os dados do cartão, tente outro cartão ou pague com Pix.";

export interface PaymentOutcome {
  /** Status HTTP da resposta; ausente quando não houve resposta (erro de rede). */
  status?: number;
  /** `code` do corpo da resposta, quando houver. */
  code?: string;
}

/** O servidor confirmou que o cartão foi recusado: a tentativa terminou e não vai mais mudar. */
export function isDefinitiveCardFailure(outcome: PaymentOutcome): boolean {
  return outcome.status === 402 && outcome.code === "CARD_PAYMENT_DECLINED";
}

/** A chave a usar no próximo envio: nova só na recusa definitiva, a mesma em todo o resto. */
export function nextIdempotencyKey(
  currentKey: string,
  outcome: PaymentOutcome,
  generateKey: () => string,
): string {
  return isDefinitiveCardFailure(outcome) ? generateKey() : currentKey;
}

/** Oferece o Pix em destaque: recusa de cartão ou limite de tentativas de cartão do pedido. */
export function shouldSuggestPix(outcome: PaymentOutcome): boolean {
  return isDefinitiveCardFailure(outcome) || outcome.code === "CARD_ATTEMPTS_EXCEEDED";
}
