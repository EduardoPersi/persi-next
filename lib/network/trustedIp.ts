import { isIP } from "node:net";

/**
 * O IP do cliente para o LIMITE DE PAGAMENTO, só de fonte confiável.
 *
 * `cf-connecting-ip` é definido pela Cloudflare, que fica na frente do domínio
 * público e sobrescreve esse cabeçalho em todo pedido que passa por ela: quem
 * navega pelo site não consegue forjá-lo.
 *
 * `x-forwarded-for` e `x-real-ip` NÃO entram aqui. O primeiro item do
 * `x-forwarded-for` é escrito pelo próprio cliente, e o último, com a
 * Cloudflare + o proxy da Hostinger no caminho, pode ser o IP de um servidor
 * da borda (todo cliente cairia no mesmo balde). Sem o IP confiável, o limite
 * não se aplica (ver `createUniqueKeyRateLimiter`).
 *
 * O `getRequestIp` de lib/recaptcha/verify.ts, usado pelos demais limitadores
 * e pelo reCAPTCHA, continua como está.
 */
export function getTrustedClientIp(headers: Headers): string {
  const valor = headers.get("cf-connecting-ip")?.trim() ?? "";
  return isIP(valor) !== 0 ? valor : "";
}
