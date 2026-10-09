/**
 * Limite de REQUISIÇÕES por IP de confiança (cada requisição conta), para
 * rotas que o checkout consulta sozinho, como a espera do pagamento. Mesma
 * regra do limite de pagamento: o IP vem só de `cf-connecting-ip`
 * (trustedIp.ts); sem ele o limite NÃO se aplica (nada de balde "desconhecido")
 * e sai um aviso no log a cada ocorrência, com a rota e a contagem, sem dado
 * pessoal.
 *
 * Puro: o jeito de ler o IP, o aviso e o relógio entram de fora, para testar
 * sem rede. Memória de processo único, como o resto de rateLimit.ts.
 */
export function createTrustedIpLimiter(options: {
  windowMs: number;
  maxRequests: number;
  route: string;
  getIp: (headers: Headers) => string;
  warn: (message: string, data: { route: string; ocorrencias: number }) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const requests = new Map<string, number[]>();
  let lastPruneAt = now();
  let unknownIpCount = 0;

  function pruneStaleKeys(at: number) {
    if (at - lastPruneAt < options.windowMs) return;
    lastPruneAt = at;
    for (const [ip, timestamps] of requests) {
      if (timestamps.every((timestamp) => at - timestamp >= options.windowMs)) {
        requests.delete(ip);
      }
    }
  }

  return {
    isLimited(headers: Headers): boolean {
      const ip = options.getIp(headers);
      if (!ip) {
        unknownIpCount += 1;
        options.warn(
          "[rate-limit] IP de confiança não identificado; limite de requisições não aplicado.",
          { route: options.route, ocorrencias: unknownIpCount },
        );
        return false;
      }

      const at = now();
      pruneStaleKeys(at);
      const recent = (requests.get(ip) ?? []).filter(
        (timestamp) => at - timestamp < options.windowMs,
      );
      recent.push(at);
      requests.set(ip, recent);
      return recent.length > options.maxRequests;
    },
  };
}
