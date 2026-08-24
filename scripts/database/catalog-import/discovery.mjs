import fs from "node:fs";
import { readPrivateEnvironment } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { ATTRIBUTE_RULES, normalizeBrandName, normalizeSku, parseCompositeMeasurement, resolveGtin, slugify } from "./normalize.mjs";
import { validateCategoryGraph } from "./validate.mjs";

const CASES = ["simple", "variable", "multiple_variants", "with_gtin", "missing_gtin", "sale", "without_sale", "multiple_categories", "multiple_images", "out_of_stock", "stock_not_managed", "global_attributes", "variation_attributes", "metric_measurement", "imperial_measurement", "compound_measurement", "metric_reduction", "html_description", "pa_marca", "many_attributes"];
const found = Object.fromEntries(CASES.map((name) => [name, null]));
const environment = readPrivateEnvironment();
const extractor = new WooReadOnlyExtractor(environment);
const attributes = new Map();
const variableAudits = [];
const skuOwners = new Map();
const skuConflicts = [];
const gtinIssues = [];
const compoundExamples = [];
const candidates = new Map();
const started = performance.now();

function textOf(product) {
  return [product.name, product.description, product.short_description, ...(product.attributes ?? []).flatMap((attribute) => attribute.options ?? [])].join(" ");
}
function record(name, product, extra = {}) {
  if (!found[name]) found[name] = { wooId: product.id, sku: String(product.sku ?? "").trim() || null, ...extra };
  const entry = candidates.get(product.id) ?? { wooId: product.id, sku: String(product.sku ?? "").trim() || null, cases: [] };
  if (!entry.cases.includes(name)) entry.cases.push(name);
  candidates.set(product.id, entry);
}
function registerSku(entity, parentId) {
  const sku = normalizeSku(entity.sku);
  if (!sku.valid) return;
  const owner = skuOwners.get(sku.normalized);
  if (owner && owner !== entity.id) skuConflicts.push({ sku: sku.normalized, first: owner, second: entity.id, parentId });
  else skuOwners.set(sku.normalized, entity.id);
}

const [categories, brands, taxonomies] = await Promise.all([
  extractor.all("products/categories"), extractor.all("products/brands"), extractor.all("products/attributes"),
]);
const categoryIssues = validateCategoryGraph(categories);
const categorySlugs = new Map();
const categoryNames = new Map();
for (const category of categories) {
  const slugKey = `${category.parent}:${category.slug}`;
  if (categorySlugs.has(slugKey)) categoryIssues.push({ code: "CATEGORY_DUPLICATE_SLUG", ids: [categorySlugs.get(slugKey), category.id] }); else categorySlugs.set(slugKey, category.id);
  const nameKey = `${category.parent}:${normalizeBrandName(category.name).toLocaleLowerCase("pt-BR")}`;
  if (categoryNames.has(nameKey)) categoryIssues.push({ code: "CATEGORY_DUPLICATE_NORMALIZED_NAME", ids: [categoryNames.get(nameKey), category.id] }); else categoryNames.set(nameKey, category.id);
}
const brandGroups = new Map();
for (const brand of brands) {
  const key = slugify(normalizeBrandName(brand.name));
  const group = brandGroups.get(key) ?? [];
  group.push({ id: brand.id, name: brand.name });
  brandGroups.set(key, group);
}
const ambiguousBrands = [...brandGroups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({ key, group }));

for await (const { product } of extractor.products({})) {
  const text = textOf(product);
  const isVariable = product.type === "variable";
  record(isVariable ? "variable" : "simple", product);
  if (product.global_unique_id || (product.meta_data ?? []).some((entry) => entry.key === "hwp_product_gtin" && String(entry.value).trim())) record("with_gtin", product); else record("missing_gtin", product);
  record(product.sale_price ? "sale" : "without_sale", product);
  if ((product.categories?.length ?? 0) > 1) record("multiple_categories", product);
  if ((product.images?.length ?? 0) > 1) record("multiple_images", product);
  if (product.stock_status === "outofstock") record("out_of_stock", product);
  if (!product.manage_stock) record("stock_not_managed", product);
  if ((product.attributes ?? []).some((attribute) => attribute.id > 0)) record("global_attributes", product);
  if ((product.attributes?.length ?? 0) >= 4) record("many_attributes", product, { count: product.attributes.length });
  if (/<(?:p|ul|ol|li|table|h[2-4])\b/i.test(`${product.description ?? ""}${product.short_description ?? ""}`)) record("html_description", product);
  if ((product.attributes ?? []).some((attribute) => attribute.slug === "pa_marca")) record("pa_marca", product);
  if (/\b\d+(?:[,.]\d+)?\s*mm\b/i.test(text)) record("metric_measurement", product);
  if (/(?:\d+\s+)?\d+\s*\/\s*\d+\s*(?:"|”|pol)|\b\d+\s*(?:"|”|pol)/i.test(text)) record("imperial_measurement", product);
  const matches = [...text.matchAll(/(?:\d+[,.]?\d*\s*(?:mm)?|(?:\d+\s+)?\d+\s*\/\s*\d+\s*(?:"|”)?)(?:\s*[x×]\s*(?:\d+[,.]?\d*\s*(?:mm)?|(?:\d+\s+)?\d+\s*\/\s*\d+\s*(?:"|”)?)){1,2}/gi)];
  for (const match of matches) {
    const parsed = parseCompositeMeasurement(match[0]);
    if (!parsed) continue;
    const units = new Set(parsed.components.map((component) => component.unit));
    if (units.has("mm") && units.has("in")) record("compound_measurement", product, { display: match[0] });
    if (units.size === 1 && units.has("mm")) record("metric_reduction", product, { display: match[0] });
    if (compoundExamples.length < 20) compoundExamples.push({ wooId: product.id, raw: match[0], normalized: parsed.normalizedText, components: parsed.components.map((component) => ({ ...component, numerator: component.numerator.toString(), denominator: component.denominator.toString() })) });
  }
  for (const attribute of product.attributes ?? []) {
    const key = String(attribute.slug ?? attribute.name).toLowerCase();
    const current = attributes.get(key) ?? { name: attribute.name, taxonomy: key, occurrences: 0, products: [], values: new Set(), classification: ATTRIBUTE_RULES.get(key)?.entity === "brand" ? "brand" : ATTRIBUTE_RULES.has(key) ? "typed PIM" : "unresolved" };
    current.occurrences += 1;
    if (current.products.length < 10) current.products.push(product.id);
    for (const option of attribute.options ?? []) if (current.values.size < 10) current.values.add(option);
    attributes.set(key, current);
  }
  let variations = [];
  if (isVariable) {
    variations = await extractor.variations(product.id);
    if (variations.length > 1) record("multiple_variants", product, { count: variations.length });
    if ((product.attributes ?? []).some((attribute) => attribute.variation)) record("variation_attributes", product);
    const normalized = variations.map((variation) => ({ id: variation.id, sku: normalizeSku(variation.sku), gtin: resolveGtin(variation), attributes: variation.attributes?.length ?? 0, regularPrice: variation.regular_price, salePrice: variation.sale_price, stockStatus: variation.stock_status, manageStock: variation.manage_stock, image: variation.image?.id ?? null, dimensions: variation.dimensions, weight: variation.weight }));
    variableAudits.push({ parentId: product.id, sourceCount: product.variations?.length ?? variations.length, fetchedCount: variations.length, normalizedCount: normalized.length, variations: normalized });
    for (const variation of variations) {
      registerSku(variation, product.id);
      const gtin = resolveGtin(variation); if (!["valid", "missing"].includes(gtin.status)) gtinIssues.push({ parentId: product.id, variationId: variation.id, status: gtin.status });
    }
  } else registerSku(product, product.id);
}

const taxonomyClassification = taxonomies.map((taxonomy) => ({ id: taxonomy.id, name: taxonomy.name, slug: taxonomy.slug, classification: taxonomy.slug === "pa_marca" ? "brand" : ATTRIBUTE_RULES.has(taxonomy.slug) ? "typed PIM" : "unresolved" }));
const rankedAttributes = [...attributes.values()].map((entry) => ({ ...entry, values: [...entry.values] })).sort((a, b) => b.occurrences - a.occurrences);
const selected = [...candidates.values()].sort((a, b) => b.cases.length - a.cases.length).slice(0, 10);
const result = { generatedAt: new Date().toISOString(), matrix: Object.entries(found).map(([caseName, value]) => ({ case: caseName, found: Boolean(value), ...(value ?? {}) })), selected, variableAudits, skuConflicts, gtinIssues, compoundExamples, categories: { count: categories.length, issues: categoryIssues }, brands: { count: brands.length, ambiguousCandidates: ambiguousBrands }, taxonomies: taxonomyClassification, attributes: rankedAttributes, performance: { requests: extractor.requests, retries: extractor.retries, durationMs: Math.round(performance.now() - started) } };
fs.mkdirSync("supabase/.temp/catalog-import", { recursive: true });
fs.writeFileSync("supabase/.temp/catalog-import/discovery.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ matrix: result.matrix, selected, variableProducts: variableAudits.length, variableCountMismatches: variableAudits.filter((audit) => audit.sourceCount !== audit.normalizedCount).length, skuConflicts: skuConflicts.length, gtinIssues: gtinIssues.length, compoundExamples: compoundExamples.slice(0, 5), categories: result.categories, brands: result.brands, taxonomies: taxonomyClassification, topAttributes: rankedAttributes.slice(0, 20), performance: result.performance }, null, 2));
