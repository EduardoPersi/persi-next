/**
 * A COBRANÇA PELO WHATSAPP: o Pix ou o boleto de um pedido que ainda não foi
 * pago, mandado ao cliente pelo número da loja (o painel de atendimento envia;
 * contrato no persi-atendimento, docs/contrato-api-sites.md §3.2).
 *
 * Decisão do Eduardo (06/10/2026):
 *
 *   - Pix e boleto vão pelo WhatsApp logo depois do pedido ("agora");
 *   - o Pix ganha um lembrete perto de vencer (ele vale uma hora);
 *   - o boleto ganha um lembrete no dia do vencimento;
 *   - cartão não entra: aprovado já recebe o "Pagamento aprovado", recusado o
 *     cliente vê na tela;
 *   - só vai se o pedido ainda NÃO estiver pago.
 *
 * Quem decide "ainda não pago" é o banco: o "agora" sai logo depois de a
 * cobrança nascer, e o lembrete sai do cron de conciliação, que acabou de
 * reconsultar o Inter e só chama aqui quando a cobrança continua pendente. O
 * painel ainda confere de novo (pedido pago ou cancelado lá não é cobrado).
 *
 * Desligado por padrão: `PAINEL_ENVIAR_COBRANCA=1` liga, depois que o painel
 * novo estiver no ar. Nada aqui lança — o pedido vale mais que o aviso.
 */

import { SITE_URL } from "../routing/storefrontUrls.ts";
import { optinWhatsappDoPedido } from "./optin.ts";
import { avisarPeloWhatsapp, type AvisoDeCobranca, type ResultadoDoAviso } from "./whatsapp.ts";

export type FormaDeCobranca = "pix" | "boleto";
export type MomentoDaCobranca = "agora" | "lembrete";

/** Mesmo nome de `COBRANCA_WHATSAPP_META` em services/woocommerce/orders.ts. */
export const META_COBRANCA_WHATSAPP = "_persi_cobranca_whatsapp";

/**
 * O lembrete do Pix sai quando faltam até 20 minutos para vencer. Com o cron
 * passando a cada 5 minutos (o recomendado), cai por volta dos 15–20 minutos
 * antes; a janela maior que o intervalo é o que garante que nenhum Pix passa
 * sem lembrete entre duas passadas.
 */
export const LEMBRETE_DO_PIX_MS = 20 * 60 * 1000;

/** Menos que isto para vencer, não vale mandar: o código morre antes de o cliente abrir o banco. */
export const FOLGA_MINIMA_DO_PIX_MS = 3 * 60 * 1000;

const FUSO = "America/Sao_Paulo";

export interface Cobranca {
  forma: FormaDeCobranca;
  /** O Pix copia e cola, ou a linha digitável do boleto. */
  codigo: string;
  valorCentavos: number;
  /** Pix: data e hora ISO. Boleto: AAAA-MM-DD. */
  venceEm: string;
}

export interface PedidoParaCobranca {
  id: number;
  billingPhone: string;
  metaData: Record<string, string>;
}

export function cobrancaLigada(env: Record<string, string | undefined> = process.env): boolean {
  const valor = env.PAINEL_ENVIAR_COBRANCA?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

const marca = (forma: FormaDeCobranca, momento: MomentoDaCobranca) => `${forma}:${momento}`;

/** As cobranças que este pedido já mandou ("pix:agora", "boleto:lembrete"…). */
export function cobrancasJaEnviadas(meta: Record<string, string>): Set<string> {
  return new Set(
    String(meta[META_COBRANCA_WHATSAPP] || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/** "2026-10-06" no fuso de São Paulo. */
export function diaEmSaoPaulo(quando: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(quando);
}

/** O total do pedido do WooCommerce ("209.40") em centavos; `null` se não servir. */
export function centavosDoTotal(total: string | number | undefined): number | null {
  const centavos = Math.round(Number(total) * 100);
  return Number.isInteger(centavos) && centavos > 0 ? centavos : null;
}

/**
 * Na passada do cron, com a cobrança AINDA pendente no banco: o que mandar,
 * se é que algo.
 *
 *   Pix:    perto de vencer (até 20 min) e sem lembrete → "lembrete";
 *           longe de vencer e sem o "agora" (o checkout não conseguiu) → "agora".
 *   Boleto: no dia do vencimento e sem lembrete → "lembrete";
 *           antes dele e sem o "agora" (a linha digitável demorou) → "agora".
 *
 * Uma mensagem por passada, no máximo.
 */
export function momentoDoCron(
  cobranca: Pick<Cobranca, "forma" | "venceEm">,
  enviadas: Set<string>,
  agora: Date = new Date(),
): MomentoDaCobranca | null {
  if (cobranca.forma === "pix") {
    const restante = new Date(cobranca.venceEm).getTime() - agora.getTime();
    if (!Number.isFinite(restante) || restante <= FOLGA_MINIMA_DO_PIX_MS) return null;
    if (restante <= LEMBRETE_DO_PIX_MS) return enviadas.has(marca("pix", "lembrete")) ? null : "lembrete";
    return enviadas.has(marca("pix", "agora")) ? null : "agora";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cobranca.venceEm)) return null;
  const hoje = diaEmSaoPaulo(agora);
  if (cobranca.venceEm < hoje) return null;
  if (cobranca.venceEm === hoje) return enviadas.has(marca("boleto", "lembrete")) ? null : "lembrete";
  return enviadas.has(marca("boleto", "agora")) ? null : "agora";
}

/** O aviso ao painel; `null` sem telefone (não há para onde mandar). */
export function montarAvisoDeCobranca(
  pedido: Pick<PedidoParaCobranca, "id" | "billingPhone"> & { metaData?: Record<string, string> },
  cobranca: Cobranca,
  momento: MomentoDaCobranca,
): AvisoDeCobranca | null {
  if (!pedido.billingPhone || !cobranca.codigo) return null;
  return {
    tipo: "cobranca",
    telefone: pedido.billingPhone,
    pedido: String(pedido.id),
    forma: cobranca.forma,
    momento,
    codigo: cobranca.codigo,
    valor_centavos: cobranca.valorCentavos,
    vence_em: cobranca.venceEm,
    link: `${SITE_URL}/minha-conta/pedidos/${pedido.id}`,
    ...(optinWhatsappDoPedido(pedido.metaData) ? {} : { optin_whatsapp: false as const }),
  };
}

/**
 * A resposta do painel encerra esta cobrança (não adianta pedir de novo)?
 * Enviada, sim. 4xx também — já enviada (409), pedido pago ou cancelado (409),
 * vencida ou o cliente pediu para parar (422), aviso torto (400). Menos o 429,
 * que é "agora não" (fora da janela de horário, ritmo do número): a próxima
 * passada do cron tenta de novo. 5xx e falha de rede também tentam de novo.
 */
export function encerraACobranca(resultado: ResultadoDoAviso): boolean {
  if (resultado.enviado) return true;
  const status = resultado.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

export interface DependenciasDaCobranca {
  env?: Record<string, string | undefined>;
  enviar?: (aviso: AvisoDeCobranca) => Promise<ResultadoDoAviso>;
  marcar?: (pedidoId: number, valor: string) => Promise<void>;
}

const marcarPadrao = async (pedidoId: number, valor: string) => {
  const { marcarCobrancaNoPedido } = await import("../../services/woocommerce/orders.ts");
  await marcarCobrancaNoPedido(pedidoId, valor);
};

/**
 * Pede ao painel para mandar a cobrança e, se a resposta encerra o assunto,
 * anota no pedido. Nunca lança.
 */
export async function enviarCobranca(
  pedido: PedidoParaCobranca,
  cobranca: Cobranca,
  momento: MomentoDaCobranca,
  deps: DependenciasDaCobranca = {},
): Promise<ResultadoDoAviso> {
  const { env = process.env, enviar = avisarPeloWhatsapp, marcar = marcarPadrao } = deps;
  if (!cobrancaLigada(env)) {
    return { enviado: false, motivo: "cobrança pelo WhatsApp desligada (PAINEL_ENVIAR_COBRANCA)", podeTentarDeNovo: false };
  }
  // Quem desmarcou a caixa de WhatsApp não recebe cobrança (e o cron não insiste).
  if (!optinWhatsappDoPedido(pedido.metaData)) {
    return { enviado: false, motivo: "o cliente desmarcou o aviso por WhatsApp", podeTentarDeNovo: false };
  }
  const enviadas = cobrancasJaEnviadas(pedido.metaData);
  const esta = marca(cobranca.forma, momento);
  if (enviadas.has(esta)) {
    return { enviado: false, motivo: "esta cobrança já foi enviada", podeTentarDeNovo: false };
  }
  const aviso = montarAvisoDeCobranca(pedido, cobranca, momento);
  if (!aviso) return { enviado: false, motivo: "pedido sem telefone ou sem código", podeTentarDeNovo: false };

  let resultado: ResultadoDoAviso;
  try {
    resultado = await enviar(aviso);
  } catch {
    resultado = { enviado: false, motivo: "falha inesperada ao avisar o painel", podeTentarDeNovo: true };
  }

  if (encerraACobranca(resultado)) {
    enviadas.add(esta);
    const valor = [...enviadas].join(",");
    try {
      await marcar(pedido.id, valor);
      pedido.metaData[META_COBRANCA_WHATSAPP] = valor;
    } catch (erro) {
      // Sem a marca, a próxima passada pede de novo e o painel responde 409 —
      // nenhuma mensagem em dobro, só uma chamada a mais.
      console.error(`[whatsapp] cobrança do pedido ${pedido.id} enviada, mas não anotada no pedido`, {
        code: erro instanceof Error ? erro.name : "UNKNOWN",
      });
    }
  }
  if (!resultado.enviado) {
    console.error(`[whatsapp] cobrança ${esta} do pedido ${pedido.id} não enviada: ${resultado.motivo}`);
  }
  return resultado;
}
