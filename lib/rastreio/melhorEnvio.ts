/**
 * LEITURA DO RASTREIO DO MELHOR ENVIO NO PEDIDO DO WOOCOMMERCE. Sem dependências:
 * serve ao serviço de pedidos, ao aviso do WhatsApp e à tela Minha conta.
 *
 * Hoje quem pede a etiqueta e consulta o rastreio é o plugin "WC Melhor Envio"
 * (WordPress): ele grava o código no pedido, no meta
 * `_melhor_envio_tracking_codes` — uma LISTA. Quando o Melhor Envio ligar direto
 * no site, só a origem do código muda; o formato daqui continua.
 */

/** O nome do meta que o plugin grava. */
export const META_RASTREIO_MELHOR_ENVIO = "_melhor_envio_tracking_codes";

/** A mesma forma que o painel de atendimento aceita (backend/src/andamentoSite.js). */
const FORMATO_DO_CODIGO = /^[A-Za-z0-9-]{6,40}$/;
const MAXIMO_DE_CODIGOS = 5;

type MetaDoPedido = ReadonlyArray<{ key?: unknown; value?: unknown }> | undefined;

function codigoLimpo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const codigo = valor.replace(/\s/g, "");
  return FORMATO_DO_CODIGO.test(codigo) ? codigo : null;
}

/**
 * Os códigos de rastreio do pedido, na ordem, sem repetir e sem lixo. O meta
 * vem como lista (a REST API do WooCommerce já desserializa) ou, em instalações
 * antigas, como um código solto. Qualquer outra coisa — inclusive texto
 * serializado do PHP ("a:1:{…}") — é ignorada, nunca interpretada.
 */
export function rastreiosDoPedido(meta: MetaDoPedido): string[] {
  const codigos: string[] = [];
  for (const entrada of meta ?? []) {
    if (!entrada || entrada.key !== META_RASTREIO_MELHOR_ENVIO) continue;
    const valores = Array.isArray(entrada.value) ? entrada.value : [entrada.value];
    for (const valor of valores) {
      const codigo = codigoLimpo(valor);
      if (codigo && !codigos.includes(codigo)) codigos.push(codigo);
    }
  }
  return codigos.slice(0, MAXIMO_DE_CODIGOS);
}

/** A página pública de acompanhamento (a mesma que o plugin usa nos e-mails). */
export function urlDoRastreio(codigo: string): string {
  return `https://www.melhorrastreio.com.br/meu-rastreio/${encodeURIComponent(codigo)}`;
}
