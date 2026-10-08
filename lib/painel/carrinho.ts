import crypto from "node:crypto";
import type { Cart, CartItem } from "../../types/cart.ts";
import type { OrigemDaVisita } from "../tracking/origem.ts";
import {
  emailDoCarrinho,
  nomeDoCarrinho,
  whatsappDoCarrinho,
  type EtapaDoCarrinho,
} from "./carrinhoContato.ts";

/**
 * O carrinho contado ao painel de atendimento (`cart.updated`), para a
 * recuperação de carrinho abandonado. Contrato: docs/contrato-carrinho-crm.md.
 *
 * Quem monta é o SERVIDOR, a partir do carrinho real: o navegador só diz quem
 * é o cliente (contato), em que etapa está e se aceitou o WhatsApp. Itens,
 * preços e total nunca vêm do navegador.
 *
 * NUNCA entram: CPF/CNPJ, endereço completo (rua, número, complemento,
 * bairro), dado de pagamento, senha nem o token do carrinho. Do endereço só
 * saem CEP e cidade.
 *
 * Desligado por padrão: `PAINEL_ENVIAR_CARRINHO=1` liga, depois que o painel
 * estiver pronto para receber o evento.
 */

export function envioDoCarrinhoLigado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const valor = env.PAINEL_ENVIAR_CARRINHO?.trim().toLowerCase();
  return valor === "1" || valor === "true";
}

/** O identificador do carrinho: hash do token, que NÃO dá acesso ao carrinho. */
export function sessaoDoCarrinho(cartToken: string): string {
  return crypto.createHash("sha256").update(cartToken).digest("hex");
}

export interface SinalDoCarrinho {
  nome?: string;
  email?: string;
  whatsapp?: string;
  etapa: EtapaDoCarrinho;
  optinWhatsapp: boolean;
}

export interface ItemDoCarrinhoParaOPainel {
  produto_id: number;
  variacao_id: number | null;
  sku: string | null;
  nome: string;
  quantidade: number;
  preco_centavos: number;
  url: string | null;
  imagem: string | null;
  /** Só em produto com variação: os atributos escolhidos, para recriar o item. */
  variacao?: Array<{ atributo: string; valor: string }>;
}

export interface CartUpdated {
  tipo: "carrinho";
  evento: "cart.updated";
  sessao: string;
  enviado_em: string;
  contato: { nome?: string; email?: string; telefone?: string };
  optin_whatsapp: boolean;
  cep?: string;
  cidade?: string;
  etapa: EtapaDoCarrinho;
  itens: ItemDoCarrinhoParaOPainel[];
  total_centavos: number;
  moeda: string;
  cupom: string | null;
  origem?: OrigemDaVisita;
}

function emCentavos(valor: string | undefined, casas: number): number {
  if (!valor || !/^-?\d+$/.test(valor)) return 0;
  return Math.round((Number(valor) / 10 ** Math.max(0, casas)) * 100);
}

function urlDoItem(item: CartItem, siteUrl: string): string | null {
  if (!item.slug) return null;
  return `${siteUrl.replace(/\/+$/, "")}/produto/${encodeURIComponent(item.slug)}`;
}

function itemParaOPainel(item: CartItem, siteUrl: string): ItemDoCarrinhoParaOPainel {
  return {
    produto_id: item.productId,
    variacao_id: item.variationId ?? null,
    sku: item.sku?.trim() || null,
    nome: item.name.slice(0, 300),
    quantidade: item.quantity,
    preco_centavos: Math.round(item.price * 100),
    url: urlDoItem(item, siteUrl),
    imagem: item.image?.src ?? null,
    ...(item.variation.length > 0
      ? {
          variacao: item.variation.map((atributo) => ({
            atributo: atributo.attribute,
            valor: atributo.value,
          })),
        }
      : {}),
  };
}

/**
 * Monta o `cart.updated`. Devolve `null` quando não há contato válido (nem
 * e-mail nem WhatsApp): sem ele o CRM não teria como falar com ninguém.
 */
export function montarCartUpdated(entrada: {
  sinal: SinalDoCarrinho;
  cart: Cart;
  cartToken: string;
  origem?: OrigemDaVisita;
  siteUrl: string;
  agora: Date;
}): CartUpdated | null {
  const { sinal, cart } = entrada;
  const email = emailDoCarrinho(sinal.email);
  const telefone = whatsappDoCarrinho(sinal.whatsapp);
  if (!email && !telefone) return null;

  const contato: CartUpdated["contato"] = {};
  const nome = nomeDoCarrinho(sinal.nome);
  if (nome) contato.nome = nome;
  if (email) contato.email = email;
  if (telefone) contato.telefone = telefone;

  const destino = cart.shippingAddress ?? cart.billingAddress;
  const cep = (destino?.postcode ?? "").replace(/\D/g, "");
  const cidade = destino?.city?.trim().slice(0, 120);

  const itens = cart.items.map((item) => itemParaOPainel(item, entrada.siteUrl));
  const itensEmCentavos = emCentavos(cart.totals.items.value, cart.totals.items.currencyMinorUnit);
  const descontoEmCentavos = emCentavos(
    cart.totals.discount.value,
    cart.totals.discount.currencyMinorUnit,
  );

  const evento: CartUpdated = {
    tipo: "carrinho",
    evento: "cart.updated",
    sessao: sessaoDoCarrinho(entrada.cartToken),
    enviado_em: entrada.agora.toISOString(),
    contato,
    optin_whatsapp: sinal.optinWhatsapp,
    etapa: sinal.etapa,
    itens,
    total_centavos: Math.max(0, itensEmCentavos - Math.abs(descontoEmCentavos)),
    moeda: cart.currencyCode || "BRL",
    cupom: cart.coupons[0]?.code ?? null,
  };
  if (cep.length === 8) evento.cep = cep;
  if (cidade) evento.cidade = cidade;
  if (entrada.origem) evento.origem = entrada.origem;
  return evento;
}

/** Hash do conteúdo sem o horário de envio: serve para não repetir o mesmo evento. */
export function impressaoDoEvento(evento: CartUpdated): string {
  const semHorario: Partial<CartUpdated> = { ...evento };
  delete semHorario.enviado_em;
  return crypto.createHash("sha256").update(JSON.stringify(semHorario)).digest("hex");
}

export const JANELA_DE_REPETICAO_MS = 60_000;

/**
 * Registro dos últimos eventos por carrinho, em memória de processo único (a
 * Hostinger roda um único processo Node, como em `lib/network/rateLimit.ts`).
 * O mesmo conteúdo, do mesmo carrinho, dentro da janela, não é reenviado.
 */
export function criarRegistroDeEnvios(janelaMs: number = JANELA_DE_REPETICAO_MS) {
  const ultimos = new Map<string, { impressao: string; em: number }>();

  return {
    /** `true` quando deve enviar (e já registra); `false` quando é repetição. */
    deveEnviar(sessao: string, impressao: string, agora: number): boolean {
      for (const [chave, registro] of ultimos) {
        if (agora - registro.em >= janelaMs) ultimos.delete(chave);
      }
      const anterior = ultimos.get(sessao);
      if (anterior && anterior.impressao === impressao) return false;
      ultimos.set(sessao, { impressao, em: agora });
      return true;
    },
  };
}

/** Curto de propósito: o painel não pode segurar o servidor. */
const TEMPO_LIMITE_MS = 3500;

export type ResultadoDoEnvioDoCarrinho =
  | { enviado: true; status: number }
  | { enviado: false; motivo: string; status?: number };

/**
 * Manda o evento ao painel (`POST /api/webhooks/site/notificar`, chave
 * `X-Site-Webhook-Key`). Nunca lança; o log fica SEM dados pessoais.
 */
export async function enviarCartUpdatedAoPainel(
  evento: CartUpdated,
  opcoes: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    tempoLimiteMs?: number;
  } = {},
): Promise<ResultadoDoEnvioDoCarrinho> {
  const env = opcoes.env ?? process.env;
  const url = env.PAINEL_URL?.trim();
  const chave = env.SITE_WEBHOOK_KEY?.trim();
  if (!url || !chave) {
    return { enviado: false, motivo: "PAINEL_URL ou SITE_WEBHOOK_KEY não configurados" };
  }

  const buscar = opcoes.fetchImpl ?? fetch;
  const corta = new AbortController();
  const relogio = setTimeout(() => corta.abort(), opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS);
  try {
    const resposta = await buscar(`${url.replace(/\/+$/, "")}/api/webhooks/site/notificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Site-Webhook-Key": chave },
      body: JSON.stringify(evento),
      signal: corta.signal,
      cache: "no-store",
    });
    if (resposta.ok) return { enviado: true, status: resposta.status };
    return {
      enviado: false,
      motivo: `o painel respondeu ${resposta.status}`,
      status: resposta.status,
    };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === "AbortError";
    return {
      enviado: false,
      motivo: abortou ? "o painel demorou demais para responder" : "não consegui falar com o painel",
    };
  } finally {
    clearTimeout(relogio);
  }
}
