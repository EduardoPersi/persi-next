/**
 * O AVISO DE "ENVIADO" COM RASTREIO (Fase 0 do Melhor Envio).
 *
 * O plugin do WordPress grava o código no pedido e, a cada consulta, salva o
 * pedido — o que faz o WooCommerce disparar o webhook "Pedido atualizado" para
 * o site. Este módulo decide, a partir desse payload, se já dá para avisar o
 * cliente (a leitura do código mora em lib/rastreio/melhorEnvio.ts).
 *
 * Regra configurável (padrão no código, troca por variável de ambiente e,
 * depois, pelo painel):
 *   PAINEL_ENVIO_STATUS_SEM_AVISO  status do pedido que NÃO disparam "enviado"
 *                                  (padrão: pending,failed,cancelled,refunded,
 *                                  completed,trash,auto-draft).
 */

import type { DadosDaEntrega } from "../../services/woocommerce/orders.ts";
import { classificarEnvio } from "./pedido.ts";

const LIMITE_DA_TRANSPORTADORA = 60;
const STATUS_SEM_AVISO_PADRAO = "pending,failed,cancelled,refunded,completed,trash,auto-draft";

function listaDoAmbiente(valor: string | undefined, padrao: string): string[] {
  return (valor?.trim() ? valor : padrao)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function statusSemAvisoDeEnvio(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return listaDoAmbiente(env.PAINEL_ENVIO_STATUS_SEM_AVISO, STATUS_SEM_AVISO_PADRAO);
}

export interface EnvioParaAviso {
  /** Só o primeiro código vai no aviso (o painel recebe um); todos aparecem em Minha conta. */
  rastreio: string;
  transportadora?: string;
}

interface PedidoComRastreio {
  status: string;
  entrega?: DadosDaEntrega;
  rastreios?: string[];
}

/**
 * O pedido já foi despachado pela transportadora e dá para avisar? Só quando:
 *   - há código de rastreio;
 *   - o status não está na lista "sem aviso" (cancelado ou concluído: a
 *     mensagem de "enviado" depois de "entregue" não faz sentido);
 *   - o frete NÃO é da equipe da loja nem retirada (esses têm fluxo próprio).
 * `null` quando não deve avisar.
 */
export function envioParaAviso(
  pedido: PedidoComRastreio,
  env: Record<string, string | undefined> = process.env,
): EnvioParaAviso | null {
  const rastreio = pedido.rastreios?.[0];
  if (!rastreio) return null;
  if (statusSemAvisoDeEnvio(env).includes(String(pedido.status).toLowerCase())) return null;

  const frete = pedido.entrega?.frete;
  if (frete && classificarEnvio(frete.metodoId, env) !== "transportadora") return null;

  const nome = frete?.metodo?.trim().slice(0, LIMITE_DA_TRANSPORTADORA);
  return { rastreio, ...(nome ? { transportadora: nome } : {}) };
}
