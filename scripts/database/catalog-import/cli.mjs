import fs from "node:fs";
import { parseArguments, readPrivateEnvironment } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { normalizeSku, resolveGtin, ATTRIBUTE_RULES } from "./normalize.mjs";
import { validateCategoryGraph, validateProduct } from "./validate.mjs";
import { addIssue, createReport, finalizeReport } from "./report.mjs";

const options = parseArguments(process.argv.slice(2));
if (!options.dryRun) throw new Error("Importação ainda exige o gate --dry-run.");
const environment = readPrivateEnvironment();
const extractor = new WooReadOnlyExtractor(environment);
const report = createReport(options);
const started = performance.now();

const [categories, brands] = await Promise.all([
  extractor.all("products/categories"),
  extractor.all("products/brands"),
]);
report.source.categories = categories.length;
report.source.brands = brands.length;
for (const issue of validateCategoryGraph(categories)) addIssue(report, null, { severity: "CRITICAL", ...issue });

for await (const { product } of extractor.products(options)) {
  report.source.products += 1;
  report.source[product.type === "variable" ? "variable" : "simple"] += 1;
  const variations = product.type === "variable" ? await extractor.variations(product.id) : [];
  const sellable = product.type === "variable" ? variations : [product];
  report.source.variants += sellable.length;
  report.source.media += product.images?.length ?? 0;
  report.source.attributes += product.attributes?.length ?? 0;
  report.source.skuPresent += sellable.filter((entity) => normalizeSku(entity.sku).valid).length;
  report.source.gtinValid += sellable.filter((entity) => resolveGtin(entity).status === "valid").length;
  for (const attribute of product.attributes ?? []) if (ATTRIBUTE_RULES.has(String(attribute.slug ?? attribute.name).toLowerCase())) report.results.attributesMapped += 1;
  const issues = validateProduct(product, variations);
  for (const issue of issues) addIssue(report, product.id, issue);
  if (issues.some((issue) => issue.severity === "CRITICAL")) report.results.conflicts += 1;
  else report.results.valid += 1;
  console.log(JSON.stringify({ entity: "product", externalId: product.id, phase: "dry-run", result: issues.some((issue) => issue.severity === "CRITICAL") ? "conflict" : "valid", issues: issues.map((issue) => issue.code) }));
}

finalizeReport(report, extractor, started);
fs.mkdirSync("supabase/.temp/catalog-import", { recursive: true });
const reportPath = `supabase/.temp/catalog-import/dry-run-${Date.now()}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report, reportPath }, null, 2));
