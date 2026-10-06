/**
 * Eventos de negócio enviados ao `dataLayer` (e dali ao GA4 e ao Pixel, pelo
 * GTM). Os nomes das chaves são contrato com o contêiner do GTM — estão
 * documentados em `docs/45-guia-gtm-rastreio.md`; mudar aqui exige mudar lá.
 *
 * NENHUM evento carrega dado pessoal (nome, e-mail, telefone, mensagem).
 *
 * Os montadores são puros (devolvem o objeto) para serem testados; os
 * `registrar*` só empurram o resultado para o dataLayer.
 */

import { pushEcommerceEvent, pushToDataLayer } from "./gtm.ts";

export interface ItemDeEvento {
  item_id: string;
  item_name: string;
  price?: number;
  quantity: number;
}

export interface EcommerceDeEvento {
  currency: "BRL";
  value: number;
  items: ItemDeEvento[];
  transaction_id?: string;
  shipping?: number;
}

function numeroSeguro(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0;
}

/** `item_id` segue o que `add_to_cart`/`view_item` já usam: SKU, senão o id do produto. */
export function montarItem(entrada: {
  sku?: string | null;
  productId?: number | string | null;
  name: string;
  price?: number | string | null;
  quantity: number;
}): ItemDeEvento {
  const item: ItemDeEvento = {
    item_id: entrada.sku || String(entrada.productId ?? ""),
    item_name: entrada.name,
    quantity: Math.max(1, Math.trunc(entrada.quantity) || 1),
  };
  if (entrada.price !== undefined && entrada.price !== null) {
    item.price = numeroSeguro(entrada.price);
  }
  return item;
}

export function montarBeginCheckout(entrada: {
  value: number;
  items: ItemDeEvento[];
}): EcommerceDeEvento {
  return { currency: "BRL", value: numeroSeguro(entrada.value), items: entrada.items };
}

export function montarPurchase(entrada: {
  transactionId: string | number;
  value: number | string;
  shipping?: number | string;
  items: ItemDeEvento[];
}): EcommerceDeEvento {
  const ecommerce: EcommerceDeEvento = {
    transaction_id: String(entrada.transactionId),
    currency: "BRL",
    value: numeroSeguro(entrada.value),
    items: entrada.items,
  };
  if (entrada.shipping !== undefined) ecommerce.shipping = numeroSeguro(entrada.shipping);
  return ecommerce;
}

export function registrarCliqueWhatsapp(entrada: {
  posicao: string;
  linkRastreado: boolean;
  codigo?: string;
  pagina: string;
}): void {
  pushToDataLayer({
    event: "clique_whatsapp",
    whatsapp_posicao: entrada.posicao,
    whatsapp_link_rastreado: entrada.linkRastreado,
    ...(entrada.codigo ? { whatsapp_link_codigo: entrada.codigo } : {}),
    page_path: entrada.pagina,
  });
}

export function registrarGerarLead(entrada: { formulario: string; pagina: string }): void {
  pushToDataLayer({
    event: "gerar_lead",
    form_name: entrada.formulario,
    lead_tipo: "formulario",
    page_path: entrada.pagina,
  });
}

export function registrarBeginCheckout(ecommerce: EcommerceDeEvento): void {
  pushEcommerceEvent("begin_checkout", { ...ecommerce });
}

export function registrarPurchase(ecommerce: EcommerceDeEvento): void {
  pushEcommerceEvent("purchase", { ...ecommerce });
}
