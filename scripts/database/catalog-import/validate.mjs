import { moneyToMinor, normalizeSku, resolveGtin, ATTRIBUTE_RULES } from "./normalize.mjs";

export function validateCategoryGraph(categories) {
  const ids = new Set(categories.map((category) => category.id));
  const errors = [];
  for (const category of categories) {
    if (category.parent === category.id) errors.push({ code: "CATEGORY_SELF_PARENT", id: category.id });
    if (category.parent && !ids.has(category.parent)) errors.push({ code: "CATEGORY_PARENT_MISSING", id: category.id, parent: category.parent });
    const seen = new Set([category.id]);
    let current = category;
    while (current?.parent) {
      if (seen.has(current.parent)) { errors.push({ code: "CATEGORY_CYCLE", id: category.id }); break; }
      seen.add(current.parent);
      current = categories.find((candidate) => candidate.id === current.parent);
    }
  }
  return errors;
}

export function validateProduct(product, variations = []) {
  const issues = [];
  const sellable = product.type === "variable" ? variations : [product];
  if (sellable.length === 0) issues.push({ severity: "CRITICAL", code: "NO_VARIANTS" });
  for (const entity of sellable) {
    const sku = normalizeSku(entity.sku);
    if (!sku.valid) issues.push({ severity: "CRITICAL", code: "SKU_MISSING_OR_INVALID", externalId: entity.id });
    const gtin = resolveGtin(entity);
    if (!["valid", "missing", "resolved_native_precedence", "duplicate_unresolved"].includes(gtin.status)) issues.push({ severity: "HIGH", code: `GTIN_${gtin.status.toUpperCase()}`, externalId: entity.id });
    const regular = moneyToMinor(entity.regular_price);
    const sale = moneyToMinor(entity.sale_price);
    if (regular === undefined || sale === undefined || (sale !== null && regular !== null && sale > regular)) issues.push({ severity: "CRITICAL", code: "PRICE_INVALID", externalId: entity.id });
  }
  for (const attribute of product.attributes ?? []) {
    const taxonomy = String(attribute.slug ?? attribute.name ?? "").toLowerCase();
    if (!ATTRIBUTE_RULES.has(taxonomy)) issues.push({ severity: "MEDIUM", code: "ATTRIBUTE_UNMAPPED", attribute: taxonomy });
  }
  return issues;
}
