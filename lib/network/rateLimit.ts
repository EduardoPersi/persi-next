import "server-only";
import { getRequestIp } from "@/lib/recaptcha/verify";
import { getTrustedClientIp } from "./trustedIp";
import { createTrustedIpLimiter } from "./trustedIpLimiter";
import { createUniqueKeyLimiter } from "./uniqueKeyLimiter";

// Limitador em memória de processo único (a Hostinger roda um único
// processo Node persistente). Chaveia pelo IP real do cliente (via
// getRequestIp, que confia em cf-connecting-ip antes de headers
// forjáveis) para que um valor de X-Forwarded-For diferente a cada
// requisição não permita contornar o limite.
export function createRateLimiter(windowMs: number, maxRequests: number) {
  const requestLog = new Map<string, number[]>();
  let lastPruneAt = Date.now();

  function pruneStaleKeys(now: number) {
    if (now - lastPruneAt < windowMs) return;
    lastPruneAt = now;
    for (const [key, timestamps] of requestLog) {
      if (timestamps.every((timestamp) => now - timestamp >= windowMs)) {
        requestLog.delete(key);
      }
    }
  }

  return {
    isLimited(headers: Headers): boolean {
      const now = Date.now();
      pruneStaleKeys(now);

      const ip = getRequestIp(headers) || "unknown";
      const recentRequests = (requestLog.get(ip) ?? []).filter(
        (timestamp) => now - timestamp < windowMs,
      );

      recentRequests.push(now);
      requestLog.set(ip, recentRequests);

      return recentRequests.length > maxRequests;
    },
  };
}

// Conta tentativas DISTINTAS por IP (cada chave conta uma vez dentro da
// janela): repetir a mesma chave, como a retentativa do mesmo pagamento com a
// mesma chave de idempotência, não é tentativa nova. A lógica está em
// uniqueKeyWindow.ts.
//
// O IP vem só de fonte confiável (`cf-connecting-ip`, trustedIp.ts). Sem ele,
// o limite NÃO se aplica (nada de balde "desconhecido" com todo mundo junto) e
// sai um aviso no log a CADA ocorrência, com a rota e quantas já houve desde que
// o servidor subiu (para ver depois do deploy se acontece em todo pedido). Sem
// dado pessoal: nem IP, nem chave, nem cabeçalhos.
export function createUniqueKeyRateLimiter(
  windowMs: number,
  maxAttempts: number,
  route: string,
) {
  return createUniqueKeyLimiter({
    windowMs,
    maxAttempts,
    route,
    getIp: getTrustedClientIp,
    warn: (message, data) => console.warn(message, data),
  });
}

// Conta REQUISIÇÕES por IP de confiança (`cf-connecting-ip`, trustedIp.ts):
// sem o IP o limite não se aplica e sai um aviso no log com a rota. Para rotas
// que o próprio checkout consulta sozinho (ex.: espera do pagamento). Os
// limitadores acima não mudam.
export function createTrustedIpRateLimiter(
  windowMs: number,
  maxRequests: number,
  route: string,
) {
  return createTrustedIpLimiter({
    windowMs,
    maxRequests,
    route,
    getIp: getTrustedClientIp,
    warn: (message, data) => console.warn(message, data),
  });
}
