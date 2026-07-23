export const institutionalPageMap = {
  "sobre-nos": {
    wordpressSlug: "sobre-nos",
    title: "Sobre nós",
  },
  "politica-de-troca-e-devolucao": {
    wordpressSlug: "politica-de-troca-e-devolucao",
    title: "Política de troca e devolução",
  },
  "duvidas-frequentes": {
    wordpressSlug: "duvidas-frequentes",
    title: "Dúvidas frequentes",
  },
  "politica-de-pagamento": {
    wordpressSlug: "politica-de-pagamento",
    title: "Política de pagamento",
  },
  "politica-de-privacidade-e-seguranca": {
    wordpressSlug: "politica-de-privacidade",
    title: "Política de privacidade e segurança",
  },
  "politica-de-seguranca": {
    wordpressSlug: "politica-de-seguranca",
    title: "Política de segurança",
  },
  "politica-de-entrega": {
    wordpressSlug: "politica-de-entrega",
    title: "Política de entrega",
  },
  "termos-de-uso": {
    wordpressSlug: "termos-de-uso",
    title: "Termos de uso",
  },
  "frete-gratis-na-regiao": {
    wordpressSlug: "frete-gratis-na-regiao",
    title: "Frete grátis na região",
  },
  contato: {
    wordpressSlug: "contato",
    title: "Contato",
  },
  "rastrear-pedido": {
    wordpressSlug: "rastrear-pedido",
    title: "Rastrear pedido",
  },
} as const;

export type InstitutionalRouteSlug = keyof typeof institutionalPageMap;

export function isInstitutionalRouteSlug(
  slug: string,
): slug is InstitutionalRouteSlug {
  return Object.hasOwn(institutionalPageMap, slug);
}
