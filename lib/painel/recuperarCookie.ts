import {
  parseCheckoutPrefillParams,
  type CheckoutPrefill,
} from "../commerce/checkoutPrefill.ts";

/**
 * Cookie de vida curta que leva a recuperação do `/r/<token>` até o checkout:
 * o pré-preenchimento (nome, WhatsApp, CEP) e o aviso de "recuperamos os itens".
 *
 * `httpOnly` (o JavaScript do navegador não lê), 10 minutos. Quem lê é a página
 * do checkout, NO SERVIDOR, que entrega os dados ao navegador e manda apagar o
 * cookie logo em seguida (`DELETE /api/checkout/recuperacao`): vale uma vez só.
 * Nada de dado pessoal vai na URL.
 */

export const COOKIE_RECUPERACAO = "persi_recuperacao";
export const COOKIE_RECUPERACAO_SEGUNDOS = 10 * 60;

export interface AvisoDaRecuperacao {
  restaurados: number;
  ausentes: number;
  ajustados: number;
}

export interface RecuperacaoParaOCheckout {
  prefill: CheckoutPrefill | null;
  aviso: AvisoDaRecuperacao;
}

function contar(valor: unknown): number {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0
    ? Math.min(valor, 999)
    : 0;
}

export function serializarRecuperacao(entrada: {
  contato: { nome?: string; telefone?: string; cep?: string };
  aviso: AvisoDaRecuperacao;
}): string {
  return JSON.stringify({
    v: 1,
    nome: entrada.contato.nome,
    whatsapp: entrada.contato.telefone,
    cep: entrada.contato.cep,
    r: entrada.aviso.restaurados,
    a: entrada.aviso.ausentes,
    j: entrada.aviso.ajustados,
  });
}

/**
 * Lê o cookie e passa o contato pelo MESMO crivo do link pré-preenchido da
 * Fase A (CEP de 8 dígitos, WhatsApp de 10/11 dígitos, nome sem HTML). Cookie
 * ausente, vencido ou adulterado vira `null`.
 */
export function lerRecuperacao(bruto: string | null | undefined): RecuperacaoParaOCheckout | null {
  if (!bruto) return null;
  let dados: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(bruto);
    if (!lido || typeof lido !== "object") return null;
    dados = lido as Record<string, unknown>;
  } catch {
    return null;
  }
  if (dados.v !== 1) return null;

  const params = new URLSearchParams();
  for (const campo of ["nome", "whatsapp", "cep"] as const) {
    const valor = dados[campo];
    if (typeof valor === "string") params.set(campo, valor);
  }
  return {
    prefill: parseCheckoutPrefillParams(params),
    aviso: { restaurados: contar(dados.r), ausentes: contar(dados.a), ajustados: contar(dados.j) },
  };
}
