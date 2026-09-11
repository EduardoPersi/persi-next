// Valores mínimos de frete grátis por cidade — mesma fonte de verdade da
// página institucional /frete-gratis-na-regiao (conteúdo real do WordPress).
// Se a política mudar lá, atualizar aqui também.
export interface DeliveryRegion {
  slug: string;
  name: string;
  freeShippingMinOrder: number;
}

export const DELIVERY_REGIONS: DeliveryRegion[] = [
  { slug: "jundiai", name: "Jundiaí", freeShippingMinOrder: 99.99 },
  { slug: "varzea-paulista", name: "Várzea Paulista", freeShippingMinOrder: 99.99 },
  { slug: "itupeva", name: "Itupeva", freeShippingMinOrder: 199.99 },
  { slug: "cabreuva", name: "Cabreúva", freeShippingMinOrder: 199.99 },
  { slug: "campo-limpo-paulista", name: "Campo Limpo Paulista", freeShippingMinOrder: 199.99 },
  { slug: "louveira", name: "Louveira", freeShippingMinOrder: 199.99 },
  { slug: "vinhedo", name: "Vinhedo", freeShippingMinOrder: 199.99 },
  { slug: "cajamar", name: "Cajamar", freeShippingMinOrder: 299.99 },
  { slug: "jarinu", name: "Jarinu", freeShippingMinOrder: 299.99 },
  { slug: "itatiba", name: "Itatiba", freeShippingMinOrder: 299.99 },
  { slug: "itu", name: "Itu", freeShippingMinOrder: 399.99 },
  { slug: "sorocaba", name: "Sorocaba", freeShippingMinOrder: 399.99 },
  { slug: "campinas", name: "Campinas", freeShippingMinOrder: 399.99 },
  { slug: "indaiatuba", name: "Indaiatuba", freeShippingMinOrder: 399.99 },
  { slug: "porto-feliz", name: "Porto Feliz", freeShippingMinOrder: 399.99 },
  { slug: "valinhos", name: "Valinhos", freeShippingMinOrder: 399.99 },
  { slug: "salto", name: "Salto", freeShippingMinOrder: 499.99 },
];

export function getDeliveryRegionBySlug(slug: string): DeliveryRegion | undefined {
  return DELIVERY_REGIONS.find((region) => region.slug === slug);
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
