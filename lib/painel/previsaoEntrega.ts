/**
 * A PREVISÃO DE ENTREGA CONGELADA NO PEDIDO (fase 7 do painel).
 *
 * O checkout mostra ao cliente "Chega hoje" / "Chega amanhã, dia 9" (calculado
 * por `lib/shipping/calendar`, com corte, feriados e zonas). Essa MESMA data vai
 * ao painel de atendimento em `envio.previsao_entrega`, para ele encaixar a
 * entrega da loja sem ter um corte próprio.
 *
 * Por que congelar: o aviso de "pago" sai minutos (Pix) ou dias (boleto) depois
 * do pedido. Recalcular no pagamento daria outra data a quem viu "Chega hoje" às
 * 12h55 e pagou às 13h05. Então a data é calculada UMA vez, na criação do pedido,
 * e gravada nos metas abaixo; os avisos de pendente, pago e cancelado só leem.
 *
 * Tudo aqui fica atrás de `PAINEL_ENVIAR_PREVISAO_ENTREGA=1` (desligado por
 * padrão): sem a chave o pedido nasce exatamente como antes, sem meta, e o aviso
 * ao painel não leva o campo.
 *
 * O pedido NATIVO (Supabase) precisa gravar o mesmo campo — ver
 * docs/database/06-orders-payments.md. Nada aqui lança: o pedido vale mais que
 * a previsão.
 */

import {
  arrivalDateForRate,
  type ArrivalDestination,
  type ArrivalRate,
} from "../shipping/calendar/arrival.ts";
import { isValidCivilDate } from "../shipping/calendar/civilDate.ts";

/** Meta do pedido do WooCommerce: a data prometida ao cliente (AAAA-MM-DD). */
export const META_PREVISAO_ENTREGA = "_persi_previsao_entrega";
/** Meta do pedido: quando a data foi calculada (ISO 8601, UTC). */
export const META_PREVISAO_CALCULADA_EM = "_persi_previsao_calculada_em";

export interface PrevisaoCongelada {
  /** AAAA-MM-DD, data civil de São Paulo. */
  data: string;
  /** ISO 8601 em UTC, de quando a data foi calculada. */
  calculadaEm: string;
}

export function previsaoEntregaLigada(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const valor = env.PAINEL_ENVIAR_PREVISAO_ENTREGA?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

/** AAAA-MM-DD que existe no calendário (2026-02-30 não vale). */
export function dataCivilValida(texto: string | undefined): texto is string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? "");
  if (!partes) return false;
  return isValidCivilDate(Number(partes[1]), Number(partes[2]), Number(partes[3]));
}

function instanteValido(texto: string | undefined): texto is string {
  return Boolean(texto) && /^\d{4}-\d{2}-\d{2}T/.test(texto ?? "") && !Number.isNaN(Date.parse(texto ?? ""));
}

export interface EntradaDaPrevisao {
  /** O frete que o cliente escolheu (o mesmo que a tela usou para o "Chega…"). */
  rate: ArrivalRate;
  destino: ArrivalDestination;
  /** Só a entrega da loja tem previsão para o painel (retirada e transportadora não). */
  entregaPropria: boolean;
  agora?: Date;
  env?: Record<string, string | undefined>;
}

/**
 * Calcula a previsão a gravar no pedido, ou `null` (chave desligada, não é
 * entrega da loja, ou sem como calcular). Nunca lança.
 */
export function calcularPrevisaoCongelada(entrada: EntradaDaPrevisao): PrevisaoCongelada | null {
  const { rate, destino, entregaPropria, agora = new Date(), env = process.env } = entrada;
  if (!previsaoEntregaLigada(env) || !entregaPropria) return null;
  try {
    const metodo = rate.methodId?.trim();
    if (!metodo) return null;
    // `ownMethodIds: [metodo]` força o caminho da entrega própria (zonas e dias
    // de operação), o mesmo que a tela usou — quem decidiu que o frete é da
    // loja foi `classificarEnvio`, antes de chegar aqui.
    const data = arrivalDateForRate(rate, destino, agora, { ownMethodIds: [metodo] });
    if (!dataCivilValida(data ?? undefined)) return null;
    return { data: data as string, calculadaEm: agora.toISOString() };
  } catch {
    return null;
  }
}

/** Os metas a gravar na criação do pedido (vazio sem previsão). */
export function metasDaPrevisao(previsao: PrevisaoCongelada | null | undefined): Array<{ key: string; value: string }> {
  if (!previsao) return [];
  return [
    { key: META_PREVISAO_ENTREGA, value: previsao.data },
    { key: META_PREVISAO_CALCULADA_EM, value: previsao.calculadaEm },
  ];
}

/**
 * Lê a previsão congelada dos metas do pedido. Meta torta (data que não existe,
 * texto qualquer) é ignorada: melhor sem previsão que com uma errada.
 */
export function lerPrevisaoDoPedido(metaData: Record<string, string>): PrevisaoCongelada | null {
  const data = metaData[META_PREVISAO_ENTREGA]?.trim();
  if (!dataCivilValida(data)) return null;
  const calculadaEm = metaData[META_PREVISAO_CALCULADA_EM]?.trim();
  return { data, calculadaEm: instanteValido(calculadaEm) ? calculadaEm : "" };
}
