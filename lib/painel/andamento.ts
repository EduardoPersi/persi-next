/**
 * O ANDAMENTO DO PEDIDO PELO WHATSAPP (fase B das mensagens do site): as
 * mensagens que o WooCommerce manda por e-mail também vão pelo WhatsApp da
 * loja (o painel envia; contrato no persi-atendimento, §3.3). Os e-mails
 * continuam saindo.
 *
 * Decisão do Eduardo (06/10/2026):
 *
 *   evento        de onde vem                                   mensagem
 *   ----------    -------------------------------------------   ----------------------------
 *   cancelado     webhook "Pedido atualizado" → cancelled        "cancelado"
 *   cancelado     conciliação: Pix/boleto venceu sem pagamento   "o prazo do Pix acabou…"
 *   concluido     webhook → completed                            "entregue" (ou "retirado")
 *   reembolsado   webhook → refunded                             "reembolso feito"
 *   enviado       Melhor Envio no site (a ligar)                 "enviado", com o rastreio
 *
 * No WooCommerce da Persi, "Concluído" é ENTREGUE ao cliente.
 *
 * O "failed" do webhook NÃO vira mensagem: é a conciliação que marca o Pix e o
 * boleto vencidos como "failed" (e ela já avisa, com o motivo certo), e o
 * cartão recusado o cliente viu na tela.
 *
 * O painel põe o andamento na fila de saída: ele espera a janela de horário do
 * número e sai uma vez por pedido e evento (o webhook repete a cada mudança do
 * pedido, e o painel responde 409 às repetições).
 *
 * Desligado por padrão: `PAINEL_AVISAR_ANDAMENTO=1` liga, depois que o painel
 * novo estiver no ar. A mesma chave liga o "Pagamento aprovado" completo (o
 * aviso de pago passa a levar o nome e o total). Nada aqui lança.
 */

import { SITE_URL } from "../routing/storefrontUrls.ts";
import { andamentoLigado, classificarEnvio, FORMA_DE_PAGAMENTO, type PedidoParaAviso } from "./pedido.ts";
import { avisarPeloWhatsapp, type AvisoDeAndamento, type ResultadoDoAviso } from "./whatsapp.ts";

export type EventoDoAndamento = AvisoDeAndamento["evento"];

export { andamentoLigado };

/** Status do WooCommerce (webhook "Pedido atualizado") → andamento, se houver. */
export function eventoDoWebhook(statusWoo: string): EventoDoAndamento | null {
  if (statusWoo === "cancelled") return "cancelado";
  if (statusWoo === "completed") return "concluido";
  if (statusWoo === "refunded") return "reembolsado";
  return null;
}

/** Só o Pix e o boleto "vencem"; o cartão recusado o cliente viu na tela. */
export function formaQueVence(paymentMethod: string | undefined): "pix" | "boleto" | null {
  if (paymentMethod === "inter_pix") return "pix";
  if (paymentMethod === "inter_boleto") return "boleto";
  return null;
}

export interface ExtrasDoAndamento {
  motivo?: "loja" | "pagamento_expirado";
  transportadora?: string;
  rastreio?: string;
}

type PedidoDoAndamento = Pick<PedidoParaAviso, "id" | "billingPhone" | "total" | "paymentMethod" | "entrega">;

/** O aviso ao painel; `null` sem telefone (não há para onde mandar). */
export function montarAvisoDeAndamento(
  pedido: PedidoDoAndamento,
  evento: EventoDoAndamento,
  extras: ExtrasDoAndamento = {},
  env: Record<string, string | undefined> = process.env,
): AvisoDeAndamento | null {
  if (!pedido.billingPhone) return null;
  const aviso: AvisoDeAndamento = {
    tipo: "andamento",
    telefone: pedido.billingPhone,
    pedido: String(pedido.id),
    evento,
    link: `${SITE_URL}/minha-conta/pedidos/${pedido.id}`,
  };
  const forma = pedido.paymentMethod ? FORMA_DE_PAGAMENTO[pedido.paymentMethod] ?? pedido.paymentMethod : undefined;

  if (evento === "cancelado") {
    aviso.motivo = extras.motivo ?? "loja";
    if (forma) aviso.forma_pagamento = forma;
  }
  if (evento === "concluido" && pedido.entrega?.frete) {
    aviso.forma_envio = classificarEnvio(pedido.entrega.frete.metodoId, env);
  }
  if (evento === "reembolsado") {
    const centavos = Math.round(Number(pedido.total) * 100);
    if (Number.isInteger(centavos) && centavos > 0) aviso.valor_centavos = centavos;
    if (forma) aviso.forma_pagamento = forma;
  }
  if (evento === "enviado") {
    if (extras.transportadora) aviso.transportadora = extras.transportadora;
    if (extras.rastreio) aviso.rastreio = extras.rastreio;
  }
  return aviso;
}

/**
 * Conta o andamento ao painel. Nunca lança; sem a chave ligada, não chama.
 */
export async function avisarAndamento(
  pedido: PedidoDoAndamento,
  evento: EventoDoAndamento,
  extras: ExtrasDoAndamento = {},
  deps: { env?: Record<string, string | undefined>; enviar?: typeof avisarPeloWhatsapp } = {},
): Promise<ResultadoDoAviso> {
  const { env = process.env, enviar = avisarPeloWhatsapp } = deps;
  if (!andamentoLigado(env)) {
    return { enviado: false, motivo: "andamento pelo WhatsApp desligado (PAINEL_AVISAR_ANDAMENTO)", podeTentarDeNovo: false };
  }
  const aviso = montarAvisoDeAndamento(pedido, evento, extras, env);
  if (!aviso) return { enviado: false, motivo: "pedido sem telefone", podeTentarDeNovo: false };
  let resultado: ResultadoDoAviso;
  try {
    resultado = await enviar(aviso);
  } catch {
    resultado = { enviado: false, motivo: "falha inesperada ao avisar o painel", podeTentarDeNovo: true };
  }
  // 409 é "já avisado": o webhook repete a cada mudança do pedido, e isso é
  // o normal — não vai para o log.
  if (!resultado.enviado && resultado.status !== 409) {
    console.error(`[whatsapp] andamento ${evento} do pedido ${pedido.id} não avisado: ${resultado.motivo}`);
  }
  return resultado;
}

/**
 * O pedido despachado pela transportadora, com o rastreio. Pronto para o
 * Melhor Envio ligado direto no site chamar quando a etiqueta for gerada.
 */
export function avisarEnvioDoPedido(
  pedido: PedidoDoAndamento,
  envio: { transportadora?: string; rastreio?: string },
  deps?: Parameters<typeof avisarAndamento>[3],
): Promise<ResultadoDoAviso> {
  return avisarAndamento(pedido, "enviado", envio, deps);
}
