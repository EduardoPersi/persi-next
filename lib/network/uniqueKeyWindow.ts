/**
 * Janela deslizante que conta TENTATIVAS DISTINTAS por cliente: cada chave
 * (ex.: a chave de idempotência do pagamento) conta uma vez dentro da janela.
 * Repetir a mesma chave não é nova tentativa; uma chave nova, sim.
 *
 * Código puro e sem dependências, para testar o comportamento sem rede. O
 * limitador de verdade (`createUniqueKeyRateLimiter`, em rateLimit.ts) só dá
 * a ele o IP real do cliente. Memória de processo único, como o resto de
 * rateLimit.ts.
 */

export function createUniqueKeyWindow(
  windowMs: number,
  maxAttempts: number,
  now: () => number = Date.now,
) {
  const clients = new Map<string, Map<string, number>>();
  let lastPruneAt = now();

  function pruneClient(attempts: Map<string, number>, at: number) {
    for (const [key, startedAt] of attempts) {
      if (at - startedAt >= windowMs) attempts.delete(key);
    }
  }

  function pruneAll(at: number) {
    if (at - lastPruneAt < windowMs) return;
    lastPruneAt = at;
    for (const [client, attempts] of clients) {
      pruneClient(attempts, at);
      if (attempts.size === 0) clients.delete(client);
    }
  }

  return {
    /**
     * `true` quando esta tentativa passa do limite (e NÃO é registrada, então
     * quem foi barrado não alonga o próprio bloqueio). A mesma chave dentro da
     * janela nunca é barrada e nunca conta de novo.
     */
    isLimited(client: string, key: string): boolean {
      const at = now();
      pruneAll(at);

      const attempts = clients.get(client) ?? new Map<string, number>();
      pruneClient(attempts, at);

      if (attempts.has(key)) {
        clients.set(client, attempts);
        return false;
      }
      if (attempts.size >= maxAttempts) {
        if (attempts.size > 0) clients.set(client, attempts);
        return true;
      }
      attempts.set(key, at);
      clients.set(client, attempts);
      return false;
    },
  };
}
