import { PRODUCT_SEARCH_SYNONYM_GROUPS } from "../constants/searchSynonyms.ts";

export function normalizeCatalogSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/[‐‑–—-]+/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

export function catalogSearchTokens(value: string) {
  return normalizeCatalogSearch(value).match(/\d+(?:\/\d+)?(?:mm)?|[a-z]+/g) ?? [];
}

export function expandCatalogSearchTerms(query: string) {
  const normalized = normalizeCatalogSearch(query);
  const terms = new Set([normalized]);
  for (const group of PRODUCT_SEARCH_SYNONYM_GROUPS) {
    const aliases = group.map(normalizeCatalogSearch);
    for (const alias of aliases) if (normalized.includes(alias)) {
      for (const replacement of aliases) terms.add(normalized.replace(alias, replacement));
    }
  }
  return [...terms].filter(Boolean);
}

export function catalogSearchScore(input: { query: string; terms: string[]; sku?: string | null; gtin?: string | null; name: string; brand?: string | null; categories?: string[]; attributes?: string[] }) {
  const query = normalizeCatalogSearch(input.query), name = normalizeCatalogSearch(input.name);
  const sku = normalizeCatalogSearch(input.sku ?? ""), gtin = normalizeCatalogSearch(input.gtin ?? "");
  const brand = normalizeCatalogSearch(input.brand ?? ""), categories = normalizeCatalogSearch((input.categories ?? []).join(" "));
  const attributes = normalizeCatalogSearch((input.attributes ?? []).join(" "));
  let score = 0;
  if (sku === query) score += 3000;
  if (gtin === query) score += 2900;
  if (name === query) score += 1000;
  if (name.startsWith(query)) score += 600;
  if (name.includes(query)) score += 400;
  if (brand.includes(query)) score += 250;
  if (categories.includes(query)) score += 180;
  if (attributes.includes(query)) score += 160;
  const document = `${name} ${brand} ${categories} ${attributes}`;
  for (const term of input.terms.map(normalizeCatalogSearch)) if (term && document.includes(term)) score += 80;
  return score;
}
