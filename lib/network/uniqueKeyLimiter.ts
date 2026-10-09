import { createUniqueKeyWindow } from "./uniqueKeyWindow.ts";

/**
 * O limitador de tentativas distintas por cliente, com a regra do IP
 * desconhecido: sem IP de confiança o limite NÃO se aplica (nada de balde
 * "desconhecido" com todo mundo junto) e sai um aviso no log a CADA ocorrência,
 * com a rota e quantas já houve desde que o servidor subiu. Sem dado pessoal:
 * nem IP, nem chave, nem cabeçalhos.
 *
 * Puro: o jeito de ler o IP e o de registrar o aviso entram de fora (em
 * rateLimit.ts são `getTrustedClientIp` e `console.warn`), para testar sem rede.
 */
export function createUniqueKeyLimiter(options: {
  windowMs: number;
  maxAttempts: number;
  route: string;
  getIp: (headers: Headers) => string;
  warn: (message: string, data: { route: string; ocorrencias: number }) => void;
  now?: () => number;
}) {
  const window = createUniqueKeyWindow(options.windowMs, options.maxAttempts, options.now);
  let unknownIpCount = 0;

  return {
    isLimited(headers: Headers, key: string): boolean {
      const ip = options.getIp(headers);
      if (!ip) {
        unknownIpCount += 1;
        options.warn(
          "[rate-limit] IP de confiança não identificado; limite de tentativas não aplicado.",
          { route: options.route, ocorrencias: unknownIpCount },
        );
        return false;
      }
      return window.isLimited(ip, key);
    },
  };
}
