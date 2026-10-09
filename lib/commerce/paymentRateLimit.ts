/**
 * Limite de tentativas de pagamento por IP (`POST /api/checkout/payment`).
 *
 * 10 tentativas por minuto por IP. Repetir a MESMA chave de idempotência (o
 * mesmo envio do mesmo checkout) não conta como tentativa nova. O limite
 * protege contra quem tenta pagamentos em massa; o cliente real, com um
 * carrinho e uma chave por checkout, nunca chega perto.
 *
 * Ligado por padrão. `PAGAMENTO_RATE_LIMIT=0` (ou `false`/`off`) desliga: é o
 * que o staging usa, para os testes de carga e de concorrência não se
 * barrarem.
 */

export const PAYMENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const PAYMENT_RATE_LIMIT_MAX_ATTEMPTS = 10;
export const PAYMENT_RATE_LIMIT_MESSAGE =
  "Muitas tentativas. Aguarde um minuto e tente de novo.";

export function pagamentoRateLimitLigado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const valor = env.PAGAMENTO_RATE_LIMIT?.trim().toLowerCase();
  return !(valor === "0" || valor === "false" || valor === "off");
}
