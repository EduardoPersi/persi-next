import type { ProductCategory } from "@/types/category";

type CategoryNode = Pick<ProductCategory, "id" | "slug" | "parent">;

export const SITE_URL = "https://persimateriais.com.br";

export const RESERVED_ROOT_SLUGS = new Set([
  "api",
  "busca",
  "carrinho",
  "checkout",
  "promocoes",
  "entrar",
  "criar-conta",
  "esqueci-minha-senha",
  "redefinir-senha",
  "minha-conta",
  "trocas-e-devolucoes",
  "confirmar-notificacao",
  "remover-notificacao",
  "sobre-nos",
  "politica-de-troca-e-devolucao",
  "duvidas-frequentes",
  "politica-de-pagamento",
  "politica-de-privacidade-e-seguranca",
  "politica-de-seguranca",
  "politica-de-entrega",
  "termos-de-uso",
  "frete-gratis-na-regiao",
  "contato",
  "rastrear-pedido",
]);

export function getProductHref(slug: string) {
  return `/${encodeURIComponent(slug)}`;
}

export function getCategoryPath<T extends CategoryNode>(
  category: CategoryNode,
  categories: readonly T[],
) {
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const path: T[] = [];
  const visited = new Set<number>();
  let current: CategoryNode | undefined = category;

  while (current && !visited.has(current.id) && path.length < 20) {
    const fullCategory = categoryById.get(current.id);
    if (!fullCategory) break;
    path.unshift(fullCategory);
    visited.add(current.id);
    current =
      current.parent > 0 ? categoryById.get(current.parent) : undefined;
  }

  return path;
}

export function getCategoryHref<T extends CategoryNode>(
  category: CategoryNode,
  categories: readonly T[],
) {
  const path = getCategoryPath(category, categories);
  const segments = path.length > 0 ? path.map((item) => item.slug) : [category.slug];
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

export function findCategoryByPath<T extends ProductCategory>(
  segments: readonly string[],
  categories: readonly T[],
) {
  if (segments.length === 0) return undefined;

  const category = categories.find(
    (item) => item.slug === segments.at(-1),
  );
  if (!category) return undefined;

  const canonicalSegments = getCategoryPath(category, categories).map(
    (item) => item.slug,
  );
  return canonicalSegments.length === segments.length &&
    canonicalSegments.every((segment, index) => segment === segments[index])
    ? category
    : undefined;
}

export function getLegacyProductRedirect(pathname: string) {
  const match = pathname.match(/^\/produto\/([^/]+)\/?$/);
  return match ? getProductHref(decodeURIComponent(match[1])) : undefined;
}
