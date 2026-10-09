/**
 * Limite de cartões recusados por PEDIDO, independente do IP.
 *
 * Cada tentativa de pagamento do site cria um pedido novo no WooCommerce (uma
 * chave de idempotência por checkout), então "o mesmo pedido" é o mesmo
 * CARRINHO: a `sessao` (hash do token do carrinho, lib/painel/carrinho.ts)
 * liga todas as tentativas de quem está pagando aquele carrinho. A contagem
 * NÃO usa IP: vale com IP desconhecido ou trocando de IP entre tentativas.
 *
 * Depois de 5 recusas de cartão, a 6ª tentativa de cartão no mesmo carrinho é
 * barrada com uma mensagem oferecendo o Pix. Pix e boleto não são afetados.
 *
 * Memória de processo único (a Hostinger roda um só), como os limitadores de
 * rateLimit.ts: reiniciar o servidor zera a contagem. Desligado junto com o
 * limite de tentativas (`PAGAMENTO_RATE_LIMIT=0`).
 */

export const CARD_DECLINE_LIMIT = 5;
export const CARD_DECLINE_TTL_MS = 24 * 60 * 60 * 1000;
export const CARD_ATTEMPTS_EXCEEDED_MESSAGE =
  "Muitas tentativas com cartão neste pedido. Para continuar, pague com Pix.";

export function createCardDeclineCounter(
  limit: number = CARD_DECLINE_LIMIT,
  ttlMs: number = CARD_DECLINE_TTL_MS,
  now: () => number = Date.now,
) {
  const declines = new Map<string, { count: number; lastAt: number }>();
  let lastPruneAt = now();

  function prune(at: number) {
    if (at - lastPruneAt < ttlMs) return;
    lastPruneAt = at;
    for (const [session, entry] of declines) {
      if (at - entry.lastAt >= ttlMs) declines.delete(session);
    }
  }

  return {
    /** O carrinho já teve `limit` recusas: novas tentativas de cartão são barradas. */
    isBlocked(session: string): boolean {
      if (!session) return false;
      const at = now();
      prune(at);
      const entry = declines.get(session);
      if (!entry) return false;
      if (at - entry.lastAt >= ttlMs) {
        declines.delete(session);
        return false;
      }
      return entry.count >= limit;
    },

    /** Conta uma recusa de cartão (só recusa de verdade, nunca a repetição da mesma). */
    recordDecline(session: string): void {
      if (!session) return;
      const at = now();
      prune(at);
      const entry = declines.get(session);
      const active = entry && at - entry.lastAt < ttlMs ? entry : undefined;
      declines.set(session, { count: (active?.count ?? 0) + 1, lastAt: at });
    },
  };
}
