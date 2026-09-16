import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import { measurementPattern } from "../lib/pim/normalization.ts";
import {
  truncateAtCompatibilityClause,
  maskModelCodeDottedAbbreviation,
  maskNonLengthDimensionRole,
  normalizeMeterWordVariants,
  findLampCountNumbers,
  maskLampCountMisreadAsVolume,
  maskBrandNameMisreadAsMeasurement,
} from "../lib/pim/context-exclusion.ts";

function extractOne(title, description, category = null, brand = null) {
  const extractor = new PimAttributeExtractor();
  return extractor.extract({ title, description, category, brand, attributes: [] });
}
function findAttr(candidates, attribute) {
  return candidates.find((c) => c.attribute === attribute);
}

// ---------- Seção 11: Classe A -- COVERAGE_GAP_LABEL_VARIANT ----------

test("A3.5E-P2-M: 'Consumo estimado: 1,5 kg/m²' -> nenhuma medida física indevida", () => {
  const result = truncateAtCompatibilityClause("Consumo estimado: 1,5 kg/m².");
  assert.ok(!/1,5/.test(result));
});
test("A3.5E-P2-M: 'Consumo de referência: ...' -> nenhuma medida física indevida", () => {
  const result = truncateAtCompatibilityClause("Consumo de referência: 100 m por galão.");
  assert.ok(!/100/.test(result));
});
test("A3.5E-P2-M: 'Consumo estimado: X; comprimento: 2m' -> comprimento=2m sobrevive (escopo por sentença)", () => {
  const candidates = extractOne("Produto Teste", "Consumo estimado: cerca de 1kg por m². Comprimento: 2m.");
  assert.equal(findAttr(candidates, "length")?.value, "2m");
});
test("A3.5E-P2-M: SKU V0210636 real -- 'Consumo estimado:' não gera comprimento", () => {
  const candidates = extractOne(
    "Massa de Calafetar Madeira F-12 400G Imbuia - Viapol",
    "<p>Consumo estimado: 1 tubo (400g) rende aproximadamente 100 m de junta.</p>",
  );
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: SKU V0210681 real -- 'Consumo de referência:' não gera comprimento", () => {
  const candidates = extractOne(
    "Massa de Calafetar Madeira F-12 400G Branca - Viapol",
    "<p>Consumo de referência: 1 tubo rende cerca de 100 m de junta de vedação.</p>",
  );
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: 'Cobertura aproximada: 100m' também é excluído (novo membro da família de rótulos)", () => {
  const result = truncateAtCompatibilityClause("Cobertura aproximada: 100m por galão.");
  assert.ok(!/100m/.test(result));
});
test("A3.5E-P2-M: 'Rendimento médio: 50m' também é excluído", () => {
  const result = truncateAtCompatibilityClause("Rendimento médio: 50m por lata.");
  assert.ok(!/50m/.test(result));
});
test("A3.5E-P2-M: rótulo sem dois-pontos nunca é truncado (ex.: 'Rendimento Extra' como nome de linha)", () => {
  const result = truncateAtCompatibilityClause("Tinta Rendimento Extra Cor Branca 18L.");
  assert.ok(/18L/.test(result));
});

// ---------- Seção 11: Classe B -- MODEL_CODE_FRAGMENT_MISREAD_AS_MEASUREMENT ----------

test("A3.5E-P2-M: '1416 M.V.S' -> sem comprimento", () => {
  const candidates = extractOne("Reparo Registro Pressão 1416 M.V.S Master R20 - BM Reparos", null);
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: 'Plafon 1l' -> sem volume quando o texto confirma '1 lâmpada'", () => {
  const candidates = extractOne(
    "Plafon 1l Sq Porc. 100w Preto - Opl",
    "<p>Suporta 1 lâmpada de até 100w. Base E27.</p>",
  );
  assert.equal(findAttr(candidates, "volume"), undefined);
});
test("A3.5E-P2-M: 'Plafon 1 lâmpada' (forma por extenso) -> sem volume", () => {
  const candidates = extractOne(
    "Plafon Sq Porc. 100w Preto - Opl",
    "<p>Suporta 1 lâmpada de até 100w.</p>",
  );
  assert.equal(findAttr(candidates, "volume"), undefined);
});
test("A3.5E-P2-M: positivo -- 'Galão 1L' continua volume legítimo (sem menção de lâmpada)", () => {
  const candidates = extractOne("Aguarrás Galão De 1L - Universo Tintas", "<p>Solvente para diluição.</p>");
  assert.equal(findAttr(candidates, "volume")?.value, "1L");
});
test("A3.5E-P2-M: positivo -- 'Capacidade: 1 L' continua volume legítimo", () => {
  const candidates = extractOne("Produto Teste", "<p>Capacidade: 1 L.</p>");
  assert.equal(findAttr(candidates, "volume")?.value, "1L");
});
test("A3.5E-P2-M: '12 N.m' (torque) não é afetado pela máscara de código pontuado (1 grupo só, não 2+)", () => {
  const masked = maskModelCodeDottedAbbreviation("Torque de aperto: 12 N.m recomendado.");
  assert.ok(/12 N\.m/.test(masked));
});
test("A3.5E-P2-M: 'm.c.a.' segue mascarado (compatibilidade redundante e inofensiva com a nova regra)", () => {
  const masked = maskModelCodeDottedAbbreviation("Suporta até 75 m.c.a. de pressão.");
  assert.ok(!/75 m\.c\.a\./.test(masked));
});

// ---------- Seção 11/8/9/10: Achado C -- DIMENSION_ROLE_MISCLASSIFICATION ----------

test("A3.5E-P2-M: '1 metro de largura por 10 metros de comprimento' -> comprimento=10m", () => {
  const candidates = extractOne("Produto Teste", "Dimensão: 1 metro de largura por 10 metros de comprimento.");
  assert.equal(findAttr(candidates, "length")?.value, "10m");
});
test("A3.5E-P2-M: 'Largura: 1m; comprimento: 10m' -> comprimento=10m", () => {
  const candidates = extractOne("Produto Teste", "Largura: 1m. Comprimento: 10m.");
  assert.equal(findAttr(candidates, "length")?.value, "10m");
});
test("A3.5E-P2-M: 'Largura: 1m' isolado -> NÃO comprimento=1m", () => {
  const candidates = extractOne("Produto Teste", "Largura: 1m.");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: 'Altura: 2m' isolado -> NÃO comprimento=2m", () => {
  const candidates = extractOne("Produto Teste", "Altura: 2m.");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: 'Espessura: 1mm' isolado -> NÃO comprimento (já seguro via bucket mm, reconfirmado)", () => {
  const candidates = extractOne("Produto Teste", "Espessura: 1mm.");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: SKU 3698 real -- '(Altura 1,05m)' no título -> NÃO comprimento=1,05m", () => {
  const candidates = extractOne("Alicate Cortador Cabo De Aço 42 Plus 3/1 (Altura 1,05m) - Lotus", "<p>Diâmetro: 16 mm.</p>");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-M: SKU 38796 real -- '01m X 10m112527' (título) + prosa largura/comprimento (descrição) -> comprimento=10m", () => {
  const candidates = extractOne(
    "Manta Asfáltica Lajes De Baixa Circulação 01m X 10m112527 - Vedacit",
    "<p>Dimensão: 1 metro de largura por 10 metros de comprimento (10 m²). Espessura aproximada: 3 mm.</p>",
  );
  assert.equal(findAttr(candidates, "length")?.value, "10m");
});
test("A3.5E-P2-M: positivo -- 'Cabo 1 m' continua comprimento legítimo (sem rótulo de outro papel dimensional)", () => {
  const candidates = extractOne("Produto Teste", "Cabo flexível 1 m de comprimento útil.");
  assert.equal(findAttr(candidates, "length")?.value, "1m");
});
test("A3.5E-P2-M: positivo -- comprimento simples sem qualquer rótulo continua funcionando", () => {
  const candidates = extractOne("Extensão Elétrica 3 Metros Preta", null);
  assert.equal(findAttr(candidates, "length")?.value, "3m");
});

// ---------- Medidas compostas / unidades originais preservadas (Seção 9/12) ----------

test("A3.5E-P2-M: '25mm x 1/2\"' preserva ambas as unidades originais (sem conversão)", () => {
  const candidates = extractOne("Adaptador 25mm x 1/2\" PVC", "<p>Registro roscável para hidráulica.</p>", "Hidráulica");
  const bitola = findAttr(candidates, "bitola");
  assert.ok(bitola?.value.includes("25mm"));
  assert.ok(bitola?.value.includes('1/2"'));
  assert.ok(!/12,7/.test(bitola?.value ?? ""));
});
test("A3.5E-P2-M: '1/2\"' isolado permanece fração de polegada, nunca convertido para mm", () => {
  const candidates = extractOne("Registro 1/2\" Roscável", "<p>Registro para hidráulica.</p>", "Hidráulica");
  const bitola = findAttr(candidates, "bitola");
  assert.equal(bitola?.value, '1/2"');
});
test("A3.5E-P2-M: AUTOMATIC_INCH_TO_MM_CONVERSION_FOUND=NO -- parseMeasurementComponents nunca cruza unidades entre lados de um composto", async () => {
  const { parseMeasurementComponents } = await import("../lib/pim/normalization.ts");
  const components = parseMeasurementComponents('25mm x 1/2"');
  assert.equal(components[0].unit, "mm");
  assert.equal(components[1].unit, '"');
});

// ---------- Achado E (descoberto durante a reextração full-catalog): BRAND_NAME_MISREAD_AS_MEASUREMENT ----------

test("A3.5E-P2-M: SKU 14280 real -- marca '3M' não é lida como comprimento=3m; '5m' explícito sobrevive", () => {
  const candidates = extractOne(
    "Fita Isolante Imperial Slim 18mmx05m - 3M",
    "<p>Ideal para uso geral. Comprimento: 5m.</p>",
    null,
    "3M",
  );
  const length = findAttr(candidates, "length");
  assert.equal(length?.status, "CANDIDATE");
  assert.equal(length?.value, "5m");
});
test("A3.5E-P2-M: SKU 72303 real -- marca '3M' mascarada, 'Com 24 mm de largura e 50 metros de comprimento' produz comprimento=50m", () => {
  const candidates = extractOne(
    "Fita Crepe 3M 101 LA 24X50",
    "<p>Com 24 mm de largura e 50 metros de comprimento, oferece excelente aderência.</p>",
    null,
    "3M",
  );
  assert.equal(findAttr(candidates, "length")?.value, "50m");
});
test("A3.5E-P2-M: positivo -- marca comum (ex.: 'Vonder') nunca é mascarada do texto de medição", () => {
  const candidates = extractOne("Trena 5m Vonder", "<p>Trena profissional de 5m.</p>");
  assert.equal(findAttr(candidates, "length")?.value, "5m");
});
test("A3.5E-P2-M: apenas uma marca no catálogo colide com o formato de medida ('3M'); mecanismo é estrutural, não uma lista fixa", () => {
  const masked = maskBrandNameMisreadAsMeasurement("Produto 3M genérico", "3M");
  assert.ok(!/3M/.test(masked));
  const untouched = maskBrandNameMisreadAsMeasurement("Produto 3M genérico", "Vonder");
  assert.ok(/3M/.test(untouched));
});

// ---------- Funções de máscara isoladas (unidade) ----------

test("A3.5E-P2-M: normalizeMeterWordVariants converte 'metro'/'metros' para 'm' preservando o número", () => {
  assert.equal(normalizeMeterWordVariants("10 metros de comprimento"), "10m de comprimento");
  assert.equal(normalizeMeterWordVariants("1 metro de largura"), "1m de largura");
  assert.equal(normalizeMeterWordVariants("3m já abreviado"), "3m já abreviado");
});
test("A3.5E-P2-M: maskNonLengthDimensionRole cobre forma rotulada e forma em prosa", () => {
  assert.ok(!/1m/.test(maskNonLengthDimensionRole("Largura: 1m")));
  assert.ok(!/1m/.test(maskNonLengthDimensionRole("1m de largura")));
  assert.ok(/10m/.test(maskNonLengthDimensionRole("Comprimento: 10m")));
});
test("A3.5E-P2-M: findLampCountNumbers/maskLampCountMisreadAsVolume são occurrence-scoped por número", () => {
  const numbers = findLampCountNumbers("Suporta 1 lâmpada de até 100w");
  assert.ok(numbers.has("1"));
  assert.equal(maskLampCountMisreadAsVolume("Plafon 1l", numbers).trim(), "Plafon");
  assert.equal(maskLampCountMisreadAsVolume("Galão 5L", numbers), "Galão 5L");
});

// ---------- Guard de compound quebrado (normalization.ts) ----------

test("A3.5E-P2-M: 'A x B' com lado direito contaminado por dígitos não produz candidato isolado do lado esquerdo", () => {
  const matches = [..."01m X 10m112527".matchAll(measurementPattern)];
  assert.equal(matches.length, 0);
});
test("A3.5E-P2-M: composto genuíno '25mm x 1/2\"' continua casando normalmente", () => {
  const matches = [...'25mm x 1/2"'.matchAll(measurementPattern)];
  assert.equal(matches.length, 1);
  assert.equal(matches[0][0].replace(/\s+/g, " ").trim(), '25mm x 1/2"');
});
test("A3.5E-P2-M: medida simples isolada (sem separador x adjacente) continua casando", () => {
  const matches = [...'10m de comprimento'.matchAll(measurementPattern)];
  assert.equal(matches.length, 1);
  assert.equal(matches[0][0], "10m");
});
