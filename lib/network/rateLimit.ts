import "server-only";
import { getRequestIp } from "@/lib/recaptcha/verify";
import { createUniqueKeyWindow } from "./uniqueKeyWindow";

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
// mesma chave de idempotência, não é tentativa nova. Mesmo critério de IP
// acima; a lógica está em uniqueKeyWindow.ts.
export function createUniqueKeyRateLimiter(windowMs: number, maxAttempts: number) {
  const window = createUniqueKeyWindow(windowMs, maxAttempts);

  return {
    isLimited(headers: Headers, key: string): boolean {
      return window.isLimited(getRequestIp(headers) || "unknown", key);
    },
  };
}
