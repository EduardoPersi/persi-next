import "server-only";

import { getProductHref } from "@/lib/routing/storefrontUrls";
import type { Product, ProductAttribute } from "@/types/product";

/**
 * O produto como o PAINEL o enxerga.
 *
 * Esta forma é o contrato, e ela existe separada do `Product` do site de
 * propósito: o banco do catálogo está saindo do WooCommerce para o Supabase, e
 * o painel não pode sentir essa troca. Enquanto o nome dos campos daqui não
 * mudar, o site pode trocar as tripas inteiras sem o atendimento parar.
 */
export type ProdutoParaOPainel = {
  id: number;
  sku: string;
  nome: string;
  marca: string | null;
  /** Em CENTAVOS, inteiro. Dinheiro em ponto flutuante arredonda errado. */
  preco_centavos: number;
  /** O preço "de", quando o produto está em promoção. */
  preco_de_centavos: number | null;
  em_promocao: boolean;
  /** "saco", "metro", "peça"… ou null quando o cadastro não diz. */
  unidade: string | null;
  disponivel: boolean;
  link: string;
  imagem: string | null;
};

/**
 * O nome do atributo que guarda a unidade de venda.
 *
 * Hoje a unidade NÃO é campo do produto: quando existe, está como atributo no
 * cadastro. Por isso ela vem como `null` com frequência — e `null` aqui quer
 * dizer "o cadastro não informa", não "é unidade avulsa". Inventar "unidade"
 * para o atendente ler no WhatsApp seria a loja afirmando o que não sabe.
 */
const NOMES_DE_UNIDADE = /^unidade(\s+de\s+venda)?$/i;

function unidadeDe(attributes: ProductAttribute[] | undefined): string | null {
  const atributo = (attributes ?? []).find((a) => NOMES_DE_UNIDADE.test(a.name ?? ""));
  const termo = atributo?.terms?.[0]?.name?.trim();
  return termo ? termo : null;
}

/** Reais (número com vírgula) para centavos (inteiro). */
export function emCentavos(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

export function paraOPainel(product: Product, siteUrl: string): ProdutoParaOPainel {
  const preco = emCentavos(product.price) ?? 0;
  const de = emCentavos(product.regularPrice ?? null);
  // "Em promoção" só quando o preço cheio é MAIOR que o cobrado. O
  // `onSale` do catálogo já veio ligado com os dois preços iguais, e o
  // atendente mandaria "de R$ 50 por R$ 50" para o cliente.
  const emPromocao = de !== null && de > preco;

  return {
    id: product.id,
    sku: product.sku ?? "",
    nome: product.name,
    marca: product.brands?.[0]?.name ?? product.brand ?? null,
    preco_centavos: preco,
    preco_de_centavos: emPromocao ? de : null,
    em_promocao: emPromocao,
    unidade: unidadeDe(product.attributes),
    disponivel: Boolean(product.available),
    link: linkDoProduto(product, siteUrl),
    imagem: product.image?.src ?? null,
  };
}

/**
 * O link que vai para o WhatsApp do cliente.
 *
 * Absoluto e do próprio site: o `permalink` do catálogo pode vir apontando
 * para o domínio antigo do WordPress, e mandar o cliente para lá é mandá-lo
 * para uma loja que não é mais a loja.
 */
function linkDoProduto(product: Product, siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  // `getProductHref` e não um caminho escrito à mão: a loja usa URL PLANA
  // (`/cimento-cp-ii-50kg`) para preservar o que o WordPress já tinha
  // indexado, e um `/produto/` inventado aqui mandaria o cliente para um 404.
  if (product.slug) return `${base}${getProductHref(product.slug)}`;
  return base;
}
