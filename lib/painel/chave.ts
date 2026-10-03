import "server-only";

import crypto from "node:crypto";

/**
 * A chave que o PAINEL usa para falar com o site.
 *
 * É outra chave, e não a `SITE_WEBHOOK_KEY`, de propósito. As duas ligações
 * vão em direções opostas e carregam coisas diferentes: a `SITE_WEBHOOK_KEY`
 * deixa o site PEDIR o envio de uma mensagem no WhatsApp da loja; esta deixa o
 * painel LER o catálogo com preço. Uma chave só para as duas faria com que
 * vazar qualquer uma das pontas entregasse as duas coisas — e trocar a chave
 * por causa de um incidente derrubaria o que não tinha nada a ver.
 */
export function chaveDoPainel(): string | null {
  const chave = process.env.PAINEL_API_KEY?.trim();
  return chave ? chave : null;
}

/**
 * Compara a chave recebida em tempo constante.
 *
 * `===` em segredo vaza por quanto demora: quem tenta adivinhar mede a
 * diferença entre errar no primeiro caractere e errar no último. As duas
 * pontas viram hash do mesmo tamanho antes da comparação, então o tempo não
 * depende nem do conteúdo nem do comprimento.
 *
 * Sem `PAINEL_API_KEY` no ambiente, NADA passa. Um site que ainda não foi
 * ligado ao painel responde "não autorizado" a todo mundo — e não, por
 * descuido, "autorizado" a quem mandar o cabeçalho vazio.
 */
export function chaveConfere(recebida: string | null | undefined): boolean {
  const esperada = chaveDoPainel();
  if (!esperada || !recebida) return false;
  const a = crypto.createHash("sha256").update(String(recebida)).digest();
  const b = crypto.createHash("sha256").update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}
