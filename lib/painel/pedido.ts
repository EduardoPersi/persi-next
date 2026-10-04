/**
 * O pedido do site contado ao painel de atendimento
 * (`POST /api/webhooks/site/notificar`, `tipo: "pedido"`).
 *
 * Três situações, e só três:
 *
 *   pago      → `pago: true`,  status "Pagamento aprovado"
 *   pendente  → `pago: false`, status "Aguardando pagamento"
 *   cancelado → `pago: false`, status "Cancelado"
 *
 * Quem decide se o cliente recebe WhatsApp é o PAINEL, pelo `pago`. Mesmo
 * assim o site mantém a sua parte da regra: só pede o aviso de "pago" quando o
 * pedido MUDOU para pago (ver `services/payments/reconcile.ts`), então um
 * webhook repetido do banco não repete a mensagem.
 *
 * "Pendente" e "cancelado" ficam atrás de uma chave
 * (`PAINEL_NOTIFICAR_PEDIDO_PENDENTE=1`), desligada por padrão: um painel que
 * ainda não conhece o campo `pago` poderia tratar "Aguardando pagamento" como
 * um pedido qualquer e escrever ao cliente. Liga-se depois de o painel novo
 * estar no ar.
 *
 * Nada aqui lança: o pedido e o pagamento valem mais que o aviso.
 */

import { SITE_URL } from "../routing/storefrontUrls.ts";
import { lerOrigemDoPedido } from "../tracking/servidor.ts";
import { avisarPedido, type AvisoDePedido, type ResultadoDoAviso } from "./whatsapp.ts";

export type SituacaoDoPedido = "pago" | "pendente" | "cancelado";

export const STATUS_DO_AVISO: Record<SituacaoDoPedido, string> = {
  pago: "Pagamento aprovado",
  pendente: "Aguardando pagamento",
  cancelado: "Cancelado",
};

/** Mesmo nome de `_persi_origem` em `services/woocommerce/orders.ts`. */
export const META_ORIGEM_DO_PEDIDO = "_persi_origem";

/** Status do WooCommerce → situação contada ao painel. */
export function classificarPedido(statusWoo: string): SituacaoDoPedido {
  if (statusWoo === "processing" || statusWoo === "completed") return "pago";
  if (statusWoo === "failed" || statusWoo === "cancelled") return "cancelado";
  return "pendente";
}

export function avisoDePendenteLigado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const valor = env.PAINEL_NOTIFICAR_PEDIDO_PENDENTE?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

/** O que o aviso precisa saber do pedido (subconjunto do `WooCommerceOrder`). */
export interface PedidoParaAviso {
  id: number;
  billingPhone: string;
  billingEmail: string;
  /** Opcional: pedidos antigos e testes podem não ter. */
  billingName?: string;
  total?: string;
  metaData: Record<string, string>;
}

/**
 * Monta o aviso. Devolve `null` sem telefone: o painel identifica o cliente
 * pelo telefone, e nem todo checkout pede um — não é erro, não há para onde
 * mandar.
 */
export function montarAvisoDoPedido(
  pedido: PedidoParaAviso,
  situacao: SituacaoDoPedido,
): Omit<AvisoDePedido, "tipo"> | null {
  if (!pedido.billingPhone) return null;
  const aviso: Omit<AvisoDePedido, "tipo"> = {
    telefone: pedido.billingPhone,
    pedido: String(pedido.id),
    status: STATUS_DO_AVISO[situacao],
    pago: situacao === "pago",
    link: `${SITE_URL}/minha-conta/pedidos/${pedido.id}`,
  };
  if (pedido.billingEmail) aviso.email = pedido.billingEmail;
  // Nome e valor só no pedido pendente: viram o lead "pedido pendente" no
  // painel (que NÃO escreve ao cliente nesse caso). No aviso de pago ficam de
  // fora de propósito — a mensagem ao cliente continua exatamente a de sempre.
  if (situacao === "pendente") {
    if (pedido.billingName) aviso.cliente = pedido.billingName;
    const centavos = Math.round(Number(pedido.total) * 100);
    if (Number.isFinite(centavos) && centavos > 0) aviso.total_centavos = centavos;
  }
  const origem = lerOrigemDoPedido(pedido.metaData[META_ORIGEM_DO_PEDIDO]);
  if (origem) aviso.origem = origem;
  return aviso;
}

/**
 * Conta ao painel a situação do pedido. `pago` sempre vai; `pendente` e
 * `cancelado` só com a chave ligada. Nunca lança.
 */
export async function avisarSituacaoDoPedido(
  pedido: PedidoParaAviso,
  situacao: SituacaoDoPedido,
  enviar: typeof avisarPedido = avisarPedido,
): Promise<ResultadoDoAviso> {
  if (situacao !== "pago" && !avisoDePendenteLigado()) {
    return {
      enviado: false,
      motivo: "aviso de pedido pendente/cancelado desligado (PAINEL_NOTIFICAR_PEDIDO_PENDENTE)",
      podeTentarDeNovo: false,
    };
  }
  const aviso = montarAvisoDoPedido(pedido, situacao);
  if (!aviso) {
    return { enviado: false, motivo: "pedido sem telefone", podeTentarDeNovo: false };
  }
  try {
    return await enviar(aviso);
  } catch {
    return { enviado: false, motivo: "falha inesperada ao avisar o painel", podeTentarDeNovo: true };
  }
}
