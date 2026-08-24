import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ATTRIBUTE_RULES, moneyToMinor, normalizeBrandName, normalizeGtin, normalizeSku, normalizeStatus, parseCompositeMeasurement, preserveAmbiguousMeasurement, resolveGtin, slugify } from "../scripts/database/catalog-import/normalize.mjs";
import { validateCategoryGraph, validateProduct } from "../scripts/database/catalog-import/validate.mjs";
import { mapSellableItems, validateMappedItems } from "../scripts/database/catalog-import/map.mjs";
import { createWriteMetrics, mapWooSalePeriod, normalizeWooDate, planSetSync, recordWrite } from "../scripts/database/catalog-import/sync.mjs";
import { classifyFailure, createCheckpoint, databaseThreshold, loadCheckpoint, pendingExternalIds, progressLine, recordCheckpoint, saveCheckpoint, shouldAbortFailure } from "../scripts/database/catalog-import/checkpoint.mjs";
import { decimalToMinor, resolveGtinPolicy } from "../scripts/database/catalog-import/commercial-policy.mjs";

test("normaliza SKU sem inventar valor ausente", () => {
  assert.deepEqual(normalizeSku(" sku-01 "), { original: "sku-01", normalized: "SKU-01", valid: true });
  assert.equal(normalizeSku("  ").valid, false);
});
test("valida GTIN e detecta conflito entre fontes", () => {
  assert.equal(normalizeGtin("7891234567895").status, "valid");
  assert.equal(normalizeGtin("123").status, "invalid_format");
  assert.equal(resolveGtin({ global_unique_id: "7891234567895", meta_data: [{ key: "hwp_product_gtin", value: "7894900011517" }] }).status, "resolved_native_precedence");
});
test("converte money decimal para bigint sem float", () => {
  assert.equal(moneyToMinor("19.90"), 1990n);
  assert.equal(moneyToMinor("1999.90"), 199990n);
  assert.equal(moneyToMinor("262.0800000000"), 26208n);
  assert.equal(moneyToMinor("0"), 0n);
  assert.equal(moneyToMinor("999999.9900"), 99999999n);
  assert.equal(moneyToMinor("19.9999"), 2000n);
  assert.equal(moneyToMinor(""), null);
});
test("preserva datas promocionais GMT sem assumir timezone local", () => {
  assert.equal(normalizeWooDate("2026-08-23T10:30:00"), null);
  assert.deepEqual(mapWooSalePeriod({ date_on_sale_from_gmt: "2026-08-23T10:30:00", date_on_sale_to_gmt: "2026-08-24T10:30:00" }), {
    from: "2026-08-23T10:30:00.000Z", to: "2026-08-24T10:30:00.000Z", source: "gmt",
  });
  assert.deepEqual(mapWooSalePeriod({ sale_price: "9.00" }), { from: null, to: null, source: "undated" });
});
test("planeja sincronização autoritativa sem apagar definições globais", () => {
  assert.deepEqual(planSetSync(["a", "b"], ["b", "c"]), { add: ["c"], remove: ["a"], keep: ["b"] });
});
test("instrumenta writes e no-ops por entidade", () => {
  const metrics = createWriteMetrics();
  recordWrite(metrics, "media", "insert"); recordWrite(metrics, "media", "noop", 2);
  assert.deepEqual(metrics.byEntity.media, { insert: 1, update: 0, delete: 0, noop: 2 });
});
test("checkpoint retoma após interrupção sem duplicar concluídos", () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"persi-checkpoint-")),file=path.join(directory,"run.json");let checkpoint=createCheckpoint({source:"woo-read-only",target:"persi-staging",total:3});checkpoint=recordCheckpoint(checkpoint,{externalId:1,page:1,status:"imported"});saveCheckpoint(file,checkpoint);checkpoint=loadCheckpoint(file);checkpoint=recordCheckpoint(checkpoint,{externalId:1,page:1,status:"imported"});
  assert.deepEqual(pendingExternalIds(checkpoint,[1,2,3]),["2","3"]);assert.equal(checkpoint.imported,1);assert.match(progressLine(checkpoint),/^\[1\/3\] 33\.3%/);fs.rmSync(directory,{recursive:true});
});
test("failure policy diferencia record, source e system", () => {
  assert.equal(classifyFailure(new Error("SKU inválido")),"record");assert.equal(shouldAbortFailure({status:429,message:"Woo rate limit"}),true);assert.equal(classifyFailure({code:"42P01",message:"schema"}),"system");
});
test("thresholds internos alertam em 300 MiB e param em 400 MiB",()=>{assert.equal(databaseThreshold(299*1024*1024),"ok");assert.equal(databaseThreshold(300*1024*1024),"warn");assert.equal(databaseThreshold(400*1024*1024),"stop");});
test("políticas monetárias usam aritmética decimal exata",()=>{assert.equal(decimalToMinor("67.7815000000","half_up"),6778n);assert.equal(decimalToMinor("67.7850","half_up"),6779n);assert.equal(decimalToMinor("67.7850","half_even"),6778n);assert.equal(decimalToMinor("67.789","truncate"),6778n);});
test("preços reais de alta precisão seguem HALF UP",()=>{assert.deepEqual(["0.1371216600","67.7815000000","38.1942000001","2.3006666666","324.0390489485"].map((x)=>decimalToMinor(x,"half_up")),[14n,6778n,3819n,230n,32404n]);});
test("boundaries half-up são determinísticos",()=>{assert.deepEqual(["0.004","0.005","0.006","1.994","1.995","1.996"].map((x)=>decimalToMinor(x,"half_up")),[0n,1n,1n,199n,200n,200n]);});
test("política GTIN preserva autoridade, proveniência e neutraliza duplicata",()=>{const entity={global_unique_id:"7891234567895",meta_data:[{key:"hwp_product_gtin",value:"7894900011517"}]};assert.deepEqual(resolveGtinPolicy(entity),{value:"7891234567895",status:"resolved_native_precedence",candidates:["7891234567895","7894900011517"],authority:"global_unique_id"});assert.deepEqual(resolveGtinPolicy(entity,{duplicateGtins:new Set(["7891234567895"])}),{value:null,status:"duplicate_unresolved",candidates:["7891234567895"],authority:"global_unique_id"});});
test("normaliza marca e slug", () => {
  assert.equal(normalizeBrandName("  Tigre  "), "Tigre");
  assert.equal(slugify("Amanco Wavin"), "amanco-wavin");
});
test("published_at usa instante imutável da origem", () => {
  assert.deepEqual(normalizeStatus("publish", "2024-02-03T12:34:56"), { status: "active", publishedAt: "2024-02-03T12:34:56.000Z" });
  assert.throws(() => normalizeStatus("publish"), /PUBLISHED_AT_GMT_MISSING/);
});
test("detecta ciclos e parents ausentes na árvore", () => {
  assert.equal(validateCategoryGraph([{ id: 1, parent: 2 }, { id: 2, parent: 1 }]).some((issue) => issue.code === "CATEGORY_CYCLE"), true);
  assert.equal(validateCategoryGraph([{ id: 1, parent: 9 }]).some((issue) => issue.code === "CATEGORY_PARENT_MISSING"), true);
});
test("preserva medida composta e frações racionais", () => {
  const parsed = parseCompositeMeasurement('16mm x 1/2"');
  assert.equal(parsed.displayValue, '16mm x 1/2"');
  assert.deepEqual(parsed.components.map(({ numerator, denominator, unit }) => [numerator, denominator, unit]), [[16n, 1n, "mm"], [1n, 2n, "in"]]);
  assert.deepEqual(parseCompositeMeasurement('32mm x 25mm').components.map(({ numerator, denominator }) => [numerator, denominator]), [[32n, 1n], [25n, 1n]]);
  assert.equal(parseCompositeMeasurement('32 x 25mm'), null);
  assert.deepEqual(preserveAmbiguousMeasurement('20 mm x 1'), { displayValue: '20 mm x 1', normalizedText: '20 mm x 1', status: 'ambiguous', components: [] });
});
test("mapper preserva contagem e dados por variation", () => {
  const parent = { id: 10, type: "variable", variations: [11, 12] };
  const variations = [
    { id: 11, sku: "V-A", global_unique_id: "7891234567895", regular_price: "10.00", sale_price: "9.00", manage_stock: true, stock_quantity: 3, attributes: [{ name: "Cor", option: "Azul" }], image: { id: 1 } },
    { id: 12, sku: "V-B", global_unique_id: "", regular_price: "12.00", sale_price: "", manage_stock: true, stock_quantity: 0, attributes: [{ name: "Cor", option: "Branco" }] },
  ];
  const mapped = mapSellableItems(parent, variations);
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].gtin, "7891234567895");
  assert.equal(mapped[1].gtin, null);
  assert.equal(mapped[0].regularAmountMinor, 1000n);
  assert.equal(mapped[0].stockQuantity, 3n);
  assert.equal(validateMappedItems(parent, mapped).length, 0);
});
test("variation sem SKU é conflito e nunca herda SKU do parent", () => {
  const parent = { id: 10, type: "variable", sku: "PARENT", variations: [11, 12] };
  const mapped = mapSellableItems(parent, [{ id: 11, sku: "A", regular_price: "1" }, { id: 12, sku: "", regular_price: "1" }]);
  assert.equal(mapped[1].sku, "");
  assert.equal(validateMappedItems(parent, mapped).some((issue) => issue.code === "VARIATION_SKU_MISSING"), true);
});
test("validação classifica SKU ausente e atributo não mapeado", () => {
  const issues = validateProduct({ id: 1, type: "simple", sku: "", attributes: [{ slug: "pa_desconhecido" }] });
  assert.equal(issues.some((issue) => issue.code === "SKU_MISSING_OR_INVALID"), true);
  assert.equal(issues.some((issue) => issue.code === "ATTRIBUTE_UNMAPPED"), true);
});
test("atributos locais comprovados mapeiam sem inferir tamanho malformado",()=>{
  assert.equal(ATTRIBUTE_RULES.get("marca").entity,"brand");assert.equal(ATTRIBUTE_RULES.get("cor").code,"cor");assert.equal(ATTRIBUTE_RULES.has("tamanho"),false);
});
