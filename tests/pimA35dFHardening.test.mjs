import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor, hasHydraulicContext } from "../lib/pim/extractor.ts";
import { parseMeasurementComponents } from "../lib/pim/normalization.ts";

const context = (title, description = null, category = null, attributes = []) => ({
  productId: "synthetic", title, description, brand: null, category, sku: "", gtin: null, attributes,
});
const extract = (title, description = null, category = null, attributes = []) =>
  new PimAttributeExtractor().extract(context(title, description, category, attributes));
const find = (items, attribute) => items.find((item) => item.attribute === attribute);

// ---------- FIX #1: metro maiúsculo ----------

test("A3.5D-F fix #1: 1m/1M/6M/15M todos resolvem unit=m, preservando a caixa original em raw", () => {
  // "1 m"/"1 M" chegam aqui já compactados para "1m"/"1M" pelo
  // normalizeMeasurement (que remove o espaço entre número e unidade antes
  // de qualquer classificação) — cobrimos essa etapa no teste de extração
  // real logo abaixo, com o pipeline completo.
  assert.deepEqual(parseMeasurementComponents("1m"), [{ raw: "1m", numerator: 1, denominator: 1, unit: "m" }]);
  assert.deepEqual(parseMeasurementComponents("1M"), [{ raw: "1M", numerator: 1, denominator: 1, unit: "m" }]);
  assert.deepEqual(parseMeasurementComponents("6M"), [{ raw: "6M", numerator: 6, denominator: 1, unit: "m" }]);
  assert.deepEqual(parseMeasurementComponents("15M"), [{ raw: "15M", numerator: 15, denominator: 1, unit: "m" }]);
});

test("A3.5D-F fix #1: '1 M' com espaço no texto-fonte também resolve unit=m via extração real", () => {
  const items = extract("Cabo de Aço 1 M Teste");
  const length = find(items, "length");
  assert.ok(length);
  assert.equal(length.measurementComponents[0].unit, "m");
});

test("A3.5D-F fix #1: extrator real produz unit=m para comprimento com M maiúsculo, sem perder a caixa original", () => {
  const items = extract("Passa Fio Com Alma De Aco 15M Girobem");
  const length = find(items, "length");
  assert.equal(length.value, "15M");
  assert.equal(length.measurementComponents[0].unit, "m");
  assert.equal(length.measurementComponents[0].raw, "15M");
});

test("A3.5D-F fix #1: mm/cm continuam distintos de m (não regride por causa da case-insensitividade nova)", () => {
  assert.deepEqual(parseMeasurementComponents("25mm"), [{ raw: "25mm", numerator: 25, denominator: 1, unit: "mm" }]);
  assert.deepEqual(parseMeasurementComponents("25MM"), [{ raw: "25MM", numerator: 25, denominator: 1, unit: "mm" }]);
  assert.deepEqual(parseMeasurementComponents("10cm"), [{ raw: "10cm", numerator: 10, denominator: 1, unit: "cm" }]);
});

test("A3.5D-F fix #1: palavras terminadas em m/M sem serem measurement continuam fora do parser de medida", () => {
  // extractMeasurements só produz itens quando há de fato um número com
  // unidade reconhecida — uma palavra qualquer terminada em "m" (ex.: um
  // nome de marca ou termo comum) nunca chega a virar candidato de measurement.
  const items = extract("Item Genérico Sem Medida Alguma", "Descrição qualquer sem números");
  assert.equal(find(items, "length"), undefined);
  assert.equal(find(items, "bitola"), undefined);
});

// ---------- FIX #2: token de volume, não sufixo textual ----------

test("A3.5D-F fix #2 positivos: variações de caixa de ml/L são reconhecidas como volume", () => {
  const cases = [["100ml", "mL"], ["100mL", "mL"], ["500ML", "mL"], ["1L", "L"], ["18L", "L"]];
  for (const [raw, expectedUnit] of cases) {
    const items = extract(`Produto Teste ${raw}`);
    const volume = find(items, "volume");
    assert.ok(volume, `esperava volume para ${raw}`);
    assert.equal(volume.measurementComponents[0].unit, expectedUnit, `unidade errada para ${raw}`);
  }
});

test("A3.5D-F fix #2 negativos: fração de polegada nunca vira volume", () => {
  for (const title of ['Disco Serra Circular, 185mm (7,1/4pol.) X 20mm, 24 Dentes', 'Item 3/4pol Teste', 'Item 1/4pol']) {
    const items = extract(title);
    assert.equal(find(items, "volume"), undefined, `"${title}" não deveria virar volume`);
  }
});

test("A3.5D-F fix #2: caso real da A3.5D (Disco Serra Circular) não produz mais volume", () => {
  const items = extract("Disco Serra Circular, 185mm (7,1/4pol.) X 22,23mm, 24 Dentes, 1pc - Mtx");
  assert.equal(find(items, "volume"), undefined);
});

// ---------- FIX #3: bitola contextual — categoria isolada não basta ----------

test("A3.5D-F fix #3 negativo: abraçadeira SKU 105724 em categoria Elétrica não vira bitola/bitola_mm", () => {
  const items = extract(
    "Abraçadeira De Nylon Preto 2,5mmx150mm C/100 - Melfi",
    "A Abraçadeira de Nylon Preto 2,5mm x 150mm C/100 - Melfi é a solução ideal para organização de fios, cabos. Material: Nylon de alta resistência. Uso em instalações elétricas.",
    "Elétrica",
  );
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "bitola_mm"), undefined);
  const diameter = find(items, "diameter");
  assert.ok(diameter, "a medida deve permanecer como diameter residual, não desaparecer");
});

test("A3.5D-F fix #3: categoria Hidráulica isolada, sem substantivo de conexão, também não basta mais", () => {
  const items = extract("Peça Genérica 20mm x 30mm", "Descrição sem termos hidráulicos específicos.", "Hidráulica");
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "bitola_mm"), undefined);
});

test("A3.5D-F: hasHydraulicContext não recebe mais categoria (assinatura simplificada)", () => {
  assert.equal(hasHydraulicContext.length, 1);
});

// ---------- Positivos de bitola que devem continuar funcionando ----------

test("A3.5D-F positivos de bitola: substantivos hidráulicos reais continuam promovendo", () => {
  const cases = [
    ["Tubo PVC 25mm Fortlev", "bitola_mm", "25mm"],
    ["Joelho 90º Soldável 25mm Fortlev", "bitola_mm", "25mm"],
    ["Tê Ultraterm 32mm - Krona", "bitola_mm", "32mm"],
    ["Registro Esfera 1/2\" Plástico - Japi", "bitola", '1/2"'],
    ["Torneira Esfera 3/4\" Japi", "bitola", '3/4"'],
  ];
  for (const [title, attr, expectedValue] of cases) {
    const items = extract(title);
    const candidate = find(items, attr);
    assert.ok(candidate, `esperava ${attr} para "${title}"`);
    assert.equal(candidate.value, expectedValue);
  }
});

test("A3.5D-F positivo: bucha com medida composta mista continua bitola independente de contexto", () => {
  const items = extract('Bucha de Redução 25mm x 3/4" Fortlev');
  assert.equal(find(items, "bitola").value, '25mm x 3/4"');
});

// ---------- Negativos de bitola preservados desde A3.5B ----------

test("A3.5D-F negativos preservados: martelo, bolsa, ferramentas e fixadores continuam fora de bitola", () => {
  const cases = [
    "Martelo de Borracha Preto 60mm 418 - Thompson",
    "Bolsa Para Ferramentas Com 32 Bolsos, 460 X 280 X 305 mm, 1 Pc Mtx",
    "Grampo Para Fixar Cabo Coaxial 8mm BR Japi",
    'Parafuso Sextavado Rosca Parcial Din571 Soberba 1/4"',
  ];
  for (const title of cases) {
    const items = extract(title);
    assert.equal(find(items, "bitola"), undefined, `"${title}" não deveria virar bitola`);
    assert.equal(find(items, "bitola_mm"), undefined, `"${title}" não deveria virar bitola_mm`);
  }
});

// ---------- Evidência estruturada continua tendo prioridade ----------

test("A3.5D-F: atributo estruturado Bitola continua tendo prioridade sobre inferência textual, mesmo após os fixes", () => {
  const items = extract("Luva Soldável 25mm", "Luva soldável de 25mm para instalação hidráulica.", "Conexões Hidráulicas", [{ name: "bitola", value: "25mm" }]);
  const bitola = find(items, "bitola");
  assert.ok(bitola);
  assert.equal(find(items, "diameter"), undefined);
});
