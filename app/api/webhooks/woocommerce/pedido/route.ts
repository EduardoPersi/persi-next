import { after, NextResponse } from "next/server";
import { avisarAndamento, avisarEnvioDoPedido } from "@/lib/painel/andamento";
import { avisarSituacaoDoPedido } from "@/lib/painel/pedido";
import { LIMITE_DO_WEBHOOK_DE_PEDIDO, tratarWebhookDoPedido } from "@/lib/painel/webhookDoPedido";

// PEDIDO ATUALIZADO NO WOOCOMMERCE → PAINEL (fase 7 do painel de atendimento).
// A regra mora em lib/painel/webhookDoPedido.ts; aqui só a casca do Next.
//
// Cadastro no WordPress: WooCommerce › Configurações › Avançado › Webhooks ›
// Adicionar — tópico "Pedido atualizado", URL
// https://persimateriais.com.br/api/webhooks/woocommerce/pedido, e o mesmo
// segredo de PAINEL_WOO_PEDIDO_WEBHOOK_SECRET. O aviso de cancelado ao painel
// só sai com PAINEL_NOTIFICAR_PEDIDO_PENDENTE=1 (ver lib/painel/pedido.ts).

export async function POST(request: Request) {
  const tamanho = Number(request.headers.get("content-length") ?? 0);
  if (tamanho > LIMITE_DO_WEBHOOK_DE_PEDIDO) return NextResponse.json({ message: "Payload inválido." }, { status: 413 });

  const saida = tratarWebhookDoPedido({
    bruto: Buffer.from(await request.arrayBuffer()),
    tipoDeConteudo: request.headers.get("content-type"),
    assinatura: request.headers.get("x-wc-webhook-signature"),
    topico: request.headers.get("x-wc-webhook-topic"),
    segredo: process.env.PAINEL_WOO_PEDIDO_WEBHOOK_SECRET ?? "",
  });

  // Depois da resposta: o WooCommerce desativa o webhook que demora, e o painel
  // fora do ar não pode travar nada aqui. `avisarSituacaoDoPedido` nunca lança.
  const aviso = saida.avisar;
  if (aviso) after(() => avisarSituacaoDoPedido(aviso.pedido, aviso.situacao).then(() => undefined));
  // Fase B: o andamento ao cliente (cancelado, entregue, reembolso). Desligado
  // sem PAINEL_AVISAR_ANDAMENTO; o painel não repete o mesmo evento.
  const andamento = saida.andamento;
  if (andamento) after(() => avisarAndamento(andamento.pedido, andamento.evento).then(() => undefined));
  // Fase 0 do Melhor Envio: o plugin do WordPress gravou o rastreio no pedido,
  // e este webhook é como o site fica sabendo. O painel não repete o "enviado"
  // (responde 409 às repetições, que aqui são o normal).
  const envio = saida.envio;
  if (envio) {
    after(() => avisarEnvioDoPedido(envio.pedido, envio.envio).then(() => undefined));
  }
  return NextResponse.json(saida.corpo, { status: saida.status });
}
