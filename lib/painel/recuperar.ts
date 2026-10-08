/**
 * Link de recuperação de carrinho (`/r/<token>`): o que o site pergunta ao CRM
 * e como decide o que fazer com a resposta. Contrato:
 * docs/contrato-carrinho-crm.md, seção 5.
 *
 * O token é do CRM (que guarda só o hash). O site NUNCA o grava nem o registra
 * em log: ele só viaja na pergunta ao CRM.
 *
 * Desligado por padrão: `PAINEL_RECUPERAR_CARRINHO=1` liga, depois que o CRM
 * tiver o endpoint `recuperar`.
 */

export function recuperacaoLigada(env: Record<string, string | undefined> = process.env): boolean {
  const valor = env.PAINEL_RECUPERAR_CARRINHO?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

/** base64url de 32 bytes tem 43 caracteres; aceita uma folga para mudanças do CRM. */
export function tokenDeRecuperacaoValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

const ROBOS =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|linkedin|pinterest|embedly|quora|vkshare|mediapartners|lighthouse|pagespeed|headless|curl|wget|python-requests|go-http-client|okhttp|java\//i;

/**
 * Quem busca o link sem ser uma pessoa: prévia do WhatsApp, Facebook,
 * buscadores, ferramentas. Sem identificação (`User-Agent` vazio) e `HEAD`
 * também contam como robô: um navegador de verdade sempre se identifica.
 */
export function ehRoboDeLink(userAgent: string | null | undefined, method: string): boolean {
  if (method.toUpperCase() === "HEAD") return true;
  const agente = (userAgent ?? "").trim();
  if (!agente) return true;
  return ROBOS.test(agente);
}

export interface VariacaoRecuperada {
  attribute: string;
  value: string;
}

export interface ItemRecuperado {
  /** O id do WooCommerce a adicionar: a variação, quando houver, ou o produto. */
  id: number;
  quantidade: number;
  variacao?: VariacaoRecuperada[];
}

export interface DadosRecuperados {
  contato: { nome?: string; telefone?: string; cep?: string };
  itens: ItemRecuperado[];
  cupom: string | null;
}

const MAXIMO_DE_ITENS = 100;
const QUANTIDADE_MAXIMA = 999;

function inteiroPositivo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

function texto(valor: unknown, maximo: number): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim().slice(0, maximo);
  return limpo || undefined;
}

/** Confere o que o CRM devolveu; qualquer coisa fora do contrato vira `null`. */
export function interpretarRecuperacao(corpo: unknown): DadosRecuperados | null {
  if (!corpo || typeof corpo !== "object") return null;
  const dados = corpo as Record<string, unknown>;
  if (dados.ok !== true || !Array.isArray(dados.itens)) return null;

  const itens: ItemRecuperado[] = [];
  for (const bruto of dados.itens.slice(0, MAXIMO_DE_ITENS)) {
    if (!bruto || typeof bruto !== "object") continue;
    const item = bruto as Record<string, unknown>;
    const id = inteiroPositivo(item.variacao_id) ?? inteiroPositivo(item.produto_id);
    const quantidade = inteiroPositivo(item.quantidade);
    if (!id || !quantidade) continue;

    const variacao: VariacaoRecuperada[] = [];
    if (Array.isArray(item.variacao)) {
      for (const atributo of item.variacao.slice(0, 20)) {
        if (!atributo || typeof atributo !== "object") continue;
        const par = atributo as Record<string, unknown>;
        const nome = texto(par.atributo, 120);
        const valor = texto(par.valor, 200);
        if (nome && valor) variacao.push({ attribute: nome, value: valor });
      }
    }
    itens.push({
      id,
      quantidade: Math.min(quantidade, QUANTIDADE_MAXIMA),
      ...(variacao.length > 0 ? { variacao } : {}),
    });
  }

  const contato = dados.contato && typeof dados.contato === "object"
    ? (dados.contato as Record<string, unknown>)
    : {};
  return {
    contato: {
      nome: texto(contato.nome, 200),
      telefone: texto(contato.telefone, 40),
      cep: texto(contato.cep, 20),
    },
    itens,
    cupom: texto(dados.cupom, 60) ?? null,
  };
}

/** Curto de propósito: a pessoa está esperando o link abrir. */
const TEMPO_LIMITE_MS = 5000;

/**
 * Pergunta ao CRM pelo carrinho do token. Devolve `null` para QUALQUER
 * problema (token inválido, expirado, já comprado, chave errada, CRM fora do
 * ar, resposta torta): quem chama trata tudo igual e nunca mostra o motivo.
 * Nunca lança e nunca registra o token.
 */
export async function buscarRecuperacao(
  token: string,
  opcoes: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    tempoLimiteMs?: number;
  } = {},
): Promise<DadosRecuperados | null> {
  const env = opcoes.env ?? process.env;
  const url = env.PAINEL_URL?.trim();
  const chave = env.SITE_WEBHOOK_KEY?.trim();
  if (!url || !chave) return null;

  const buscar = opcoes.fetchImpl ?? fetch;
  const corta = new AbortController();
  const relogio = setTimeout(() => corta.abort(), opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS);
  try {
    const resposta = await buscar(`${url.replace(/\/+$/, "")}/api/webhooks/site/recuperar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Site-Webhook-Key": chave },
      body: JSON.stringify({ token }),
      signal: corta.signal,
      cache: "no-store",
    });
    if (resposta.status !== 200) return null;
    return interpretarRecuperacao(await resposta.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

export interface ItemDoCarrinhoAtual {
  key: string;
  id: number;
  quantity: number;
}

export type PassoDaRecuperacao =
  | { tipo: "adicionar"; item: ItemRecuperado }
  | { tipo: "aumentar"; key: string; id: number; de: number; para: number; item: ItemRecuperado };

/**
 * O que fazer para juntar os itens recuperados com o carrinho que a pessoa já
 * tem: item que não está no carrinho entra; item que já está fica com a MAIOR
 * das duas quantidades (nunca soma, nunca duplica). Itens repetidos no
 * recuperado também são unidos pela maior quantidade.
 */
export function planejarRecuperacao(
  atuais: readonly ItemDoCarrinhoAtual[],
  recuperados: readonly ItemRecuperado[],
): PassoDaRecuperacao[] {
  const unicos = new Map<number, ItemRecuperado>();
  for (const item of recuperados) {
    const anterior = unicos.get(item.id);
    if (!anterior || item.quantidade > anterior.quantidade) unicos.set(item.id, item);
  }

  const passos: PassoDaRecuperacao[] = [];
  for (const item of unicos.values()) {
    const existente = atuais.find((atual) => atual.id === item.id);
    if (!existente) {
      passos.push({ tipo: "adicionar", item });
    } else if (item.quantidade > existente.quantity) {
      passos.push({
        tipo: "aumentar",
        key: existente.key,
        id: item.id,
        de: existente.quantity,
        para: item.quantidade,
        item,
      });
    }
  }
  return passos;
}
