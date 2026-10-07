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
import type { DadosDaEntrega } from "../../services/woocommerce/orders.ts";

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

/**
 * O que um webhook de PEDIDO ATUALIZADO do WooCommerce conta ao painel (fase 7):
 * só o cancelamento. Cancelado, reembolsado ou falho no WooCommerce é "o cliente
 * não vai receber" — e o painel cancela a entrega que ainda não saiu, ou avisa o
 * gerente e o entregador da que já saiu.
 *
 * O pago NÃO vem por aqui: quem conta o pago é a conciliação do pagamento
 * (`services/payments/reconcile.ts`), que confere o banco antes.
 */
export function situacaoDoWebhook(statusWoo: string): "cancelado" | null {
  return ["cancelled", "refunded", "failed"].includes(statusWoo) ? "cancelado" : null;
}

/**
 * A chave da fase B (`PAINEL_AVISAR_ANDAMENTO=1`): o andamento do pedido pelo
 * WhatsApp (lib/painel/andamento.ts) e o "Pagamento aprovado" completo. Mora
 * aqui, e não lá, porque o aviso de pago também depende dela.
 */
export function andamentoLigado(env: Record<string, string | undefined> = process.env): boolean {
  const valor = env.PAINEL_AVISAR_ANDAMENTO?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

export function avisoDePendenteLigado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const valor = env.PAINEL_NOTIFICAR_PEDIDO_PENDENTE?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

// ---------------------------------------------------------------------------
// A FORMA DE ENVIO (fase 7 do painel)
// ---------------------------------------------------------------------------
//
// Quem decide se a entrega é da EQUIPE DA LOJA é o site — pela forma de envio
// que o cliente escolheu, que vem das zonas de frete do WooCommerce
// (`shipping_lines[0].method_id`). Decisão do Eduardo, 06/10/2026.
//
// Os métodos ficam em variáveis de ambiente, e não no código, porque os nomes
// são os da configuração do WooCommerce (WooCommerce › Configurações › Entrega)
// e podem mudar sem deploy:
//
//   PAINEL_ENVIO_LOJA      métodos de entrega da loja   (padrão: flat_rate,free_shipping)
//   PAINEL_ENVIO_RETIRADA  métodos de retirada na loja  (padrão: local_pickup,pickup_location)
//
// Qualquer outro método (Melhor Envio, Correios…) é transportadora: o pedido
// fica no painel, mas não vira entrega. Comparação pelo nome inteiro ou pelo
// começo seguido de ":" ou "_" — "flat_rate:3" casa com "flat_rate", e
// "melhorenvio_sedex" com "melhorenvio".

export type FormaDeEnvio = "loja" | "retirada" | "transportadora";

const listaDoAmbiente = (valor: string | undefined, padrao: string) =>
  (valor?.trim() ? valor : padrao)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export function classificarEnvio(
  metodoId: string,
  env: Record<string, string | undefined> = process.env,
): FormaDeEnvio {
  const metodo = metodoId.trim().toLowerCase();
  const casa = (lista: string[]) =>
    lista.some((m) => metodo === m || metodo.startsWith(`${m}:`) || metodo.startsWith(`${m}_`));
  if (casa(listaDoAmbiente(env.PAINEL_ENVIO_RETIRADA, "local_pickup,pickup_location"))) return "retirada";
  if (casa(listaDoAmbiente(env.PAINEL_ENVIO_LOJA, "flat_rate,free_shipping"))) return "loja";
  return "transportadora";
}

/** A forma de pagamento, nas palavras do painel. */
export const FORMA_DE_PAGAMENTO: Record<string, string> = {
  inter_pix: "pix",
  inter_boleto: "boleto",
  mercadopago_card: "cartão",
  pagbank_apple_pay: "Apple Pay",
  pagbank_google_pay: "Google Pay",
};

/** O que o aviso precisa saber do pedido (subconjunto do `WooCommerceOrder`). */
export interface PedidoParaAviso {
  id: number;
  billingPhone: string;
  billingEmail: string;
  /** Opcional: pedidos antigos e testes podem não ter. */
  billingName?: string;
  total?: string;
  metaData: Record<string, string>;
  /** Fase 7: endereço, itens e frete. Opcional — sem ele o aviso é o de antes. */
  entrega?: DadosDaEntrega;
  paymentMethod?: string;
}

/**
 * Os campos do pedido completo (fase 7). Vão em toda situação: o painel guarda
 * o pedido inteiro e decide sozinho o que vira entrega (só o pago de entrega da
 * loja). Nenhum deles muda a mensagem que o cliente recebe.
 */
function camposDoPedidoCompleto(
  pedido: PedidoParaAviso,
  env: Record<string, string | undefined>,
): Partial<AvisoDePedido> {
  const campos: Partial<AvisoDePedido> = {};
  const documento = (pedido.metaData._billing_cpf || pedido.metaData._billing_cnpj || "").replace(/\D/g, "");
  if (documento.length === 11 || documento.length === 14) campos.cpf_cnpj = documento;

  const entrega = pedido.entrega;
  if (entrega?.endereco) campos.endereco = { ...entrega.endereco };
  if (entrega?.itens.length) campos.itens = entrega.itens.map((item) => ({ ...item }));
  if (entrega?.frete) {
    const forma = classificarEnvio(entrega.frete.metodoId, env);
    campos.envio = {
      metodo: entrega.frete.metodo,
      entrega_propria: forma === "loja",
      retirada: forma === "retirada",
      ...(entrega.frete.centavos !== undefined ? { frete_centavos: entrega.frete.centavos } : {}),
    };
  }

  const forma = pedido.paymentMethod ? FORMA_DE_PAGAMENTO[pedido.paymentMethod] ?? pedido.paymentMethod : undefined;
  const parcelas = Number(pedido.metaData._persi_payment_installments);
  if (forma) campos.pagamento = { forma, ...(Number.isInteger(parcelas) && parcelas > 1 ? { parcelas } : {}) };
  return campos;
}

/**
 * Monta o aviso. Devolve `null` sem telefone: o painel identifica o cliente
 * pelo telefone, e nem todo checkout pede um — não é erro, não há para onde
 * mandar.
 */
export function montarAvisoDoPedido(
  pedido: PedidoParaAviso,
  situacao: SituacaoDoPedido,
  env: Record<string, string | undefined> = process.env,
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
  // Nome e valor no pedido pendente (viram o lead "pedido pendente" no painel)
  // e, com a fase B ligada, também no pago: o painel novo escreve o "Pagamento
  // aprovado" completo (itens, total, entrega). Sem a chave, o aviso de pago
  // continua sem eles — um painel antigo os poria na mensagem como "Cliente:".
  if (situacao === "pendente" || (situacao === "pago" && andamentoLigado(env))) {
    if (pedido.billingName) aviso.cliente = pedido.billingName;
    const centavos = Math.round(Number(pedido.total) * 100);
    if (Number.isFinite(centavos) && centavos > 0) aviso.total_centavos = centavos;
  }
  const origem = lerOrigemDoPedido(pedido.metaData[META_ORIGEM_DO_PEDIDO]);
  if (origem) aviso.origem = origem;
  return { ...aviso, ...camposDoPedidoCompleto(pedido, env) };
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
