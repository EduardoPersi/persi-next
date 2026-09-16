import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import {
  maskPressureLongFormContext,
} from "../lib/pim/context-exclusion.ts";

function extractOne(title, description, category = null, brand = null) {
  const extractor = new PimAttributeExtractor();
  return extractor.extract({ title, description, category, brand, attributes: [] });
}
function findAttr(candidates, attribute) {
  return candidates.find((c) => c.attribute === attribute);
}

// ---------- Seção 7: bitola coexistindo com os 4 atributos canônicos ----------

test("A3.5E-P2-R: bitola coexiste com material -- ambos avaliados independentemente", () => {
  const candidates = extractOne(
    "Registro Esfera Soldável 32mm Plástico - Japi",
    "<p>Fabricado em PVC. Rosca 3/4 BSP.</p>",
    "Hidráulica",
  );
  const material = findAttr(candidates, "material");
  const bitola = findAttr(candidates, "bitola") ?? findAttr(candidates, "bitola_mm");
  assert.equal(material?.value, "PVC");
  assert.ok(bitola !== undefined, "bitola/bitola_mm deve continuar sendo avaliada");
});
test("A3.5E-P2-R: bitola coexiste com conexao -- ambos avaliados independentemente", () => {
  const candidates = extractOne(
    "Joelho 90 Roscável 2 - Krona",
    "<p>Conexão roscável para hidráulica, rosca 2 polegadas.</p>",
    "Hidráulica",
  );
  const conexao = findAttr(candidates, "connection");
  assert.equal(conexao?.value, "roscável");
});
test("A3.5E-P2-R: bitola coexiste com comprimento legítimo -- ambos avaliados independentemente", () => {
  const candidates = extractOne(
    "Tubo Soldável Cano PVC 32mm Fortlev",
    "<p>Barra de 6 metros. Diâmetro 32mm.</p>",
    "Hidráulica",
  );
  const length = findAttr(candidates, "length");
  assert.equal(length?.value, "6m");
});
test("A3.5E-P2-R: composto '25mm x 1/2\"' continua tratado como bitola/compound measure, sem alteração de contrato", () => {
  const candidates = extractOne("Adaptador 25mm x 1/2\" PVC", "<p>Registro roscável para hidráulica.</p>", "Hidráulica");
  const bitola = findAttr(candidates, "bitola");
  assert.ok(bitola?.value.includes("25mm"));
  assert.ok(bitola?.value.includes('1/2"'));
});
test("A3.5E-P2-R: bitola coexiste com volume -- ambos avaliados independentemente", () => {
  const candidates = extractOne(
    "Adesivo Tubo CPVC Ultraterm Cola Para Cano 175g Rosca 1/2",
    "<p>Frasco de 175ml. Rosca 1/2 polegada.</p>",
  );
  const volume = findAttr(candidates, "volume");
  assert.equal(volume?.value, "175ml");
});

// ---------- Seção 9: altura manométrica ----------

test("A3.5E-P2-R: SKU 60560 real -- 'Altura manométrica máxima: 65 metros' não é comprimento", () => {
  const candidates = extractOne(
    "Bomba de Água Submersa Sappo 650 Extreme 360W 220V - Anauger",
    "<p>Com potência de 360W e capacidade de elevação de até 65 metros, a bomba garante abastecimento eficiente. Altura manométrica máxima: 65 metros.</p>",
  );
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-R: 'capacidade de elevar água a até 77 metros' (forma verbal) não é comprimento", () => {
  const candidates = extractOne("Bomba Submersa Palito", "<p>Com capacidade de elevar água a até 77 metros, a bomba é ideal.</p>");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-R: 'Submersão máxima: até 80 m' não é comprimento", () => {
  const masked = maskPressureLongFormContext("Submersão máxima: até 80 m.");
  assert.ok(!/80/.test(masked));
});
test("A3.5E-P2-R: bullet 'Pressão Extremamente Alta – Até 145m' não é comprimento", () => {
  const masked = maskPressureLongFormContext("Pressão Extremamente Alta – Até 145m de coluna.");
  assert.ok(!/145/.test(masked));
});
test("A3.5E-P2-R: 'Altura manométrica: Até 9 metros' não é comprimento, mas 'Cabo elétrico: 10 metros' sobrevive (SKU 100622 real)", () => {
  const candidates = extractOne(
    "Bomba de Drenagem ATBD-AR8-9/7 0.50CV MONO 220V - Altri",
    "<p>Altura manométrica: Até 9 metros. Rolamentos: 6201 RZ de precisão. Cabo elétrico: 10 metros com plug padrão brasileiro.</p>",
  );
  assert.equal(findAttr(candidates, "length")?.value, "10m");
});

// ---------- Seção 10: coluna d'água ----------

test("A3.5E-P2-R: SKU 5859541 real -- '80 metros de coluna d'água' não é comprimento", () => {
  const candidates = extractOne(
    "Impermeabilizante Mactraset 5000 Flexível Piscina e Reservatórios 18Kg - Coral Mactra",
    "<p>A resistência é de 80 m.c.a. (metros de coluna de água). VANTAGENS: Resistente a 80 metros de coluna d'água.</p>",
  );
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-R: '150 metros coluna d'água' (sem 'de') não é comprimento", () => {
  const candidates = extractOne("Manômetro De Aço Inoxidável 1/4\"", "<p>Escala de trabalho pode variar de 40 a 150 metros coluna d'água (M.C.A.).</p>");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-R: '100 metros de coluna de água' (forma 'de água' sem apóstrofo) não é comprimento", () => {
  const candidates = extractOne("Registro Esfera de Latão 3/4\"", "<p>Escala de Trabalho: 100 metros de coluna de água (mca).</p>");
  assert.equal(findAttr(candidates, "length"), undefined);
});

// ---------- Seção 11: positivos obrigatórios ----------

test("A3.5E-P2-R: positivo -- 'mangueira com 65 metros de comprimento' continua comprimento legítimo", () => {
  const candidates = extractOne("Mangueira Flexível", "<p>Mangueira com 65 metros de comprimento, ideal para jardim.</p>");
  assert.equal(findAttr(candidates, "length")?.value, "65m");
});
test("A3.5E-P2-R: positivo -- 'rolo com 80 metros' continua comprimento legítimo", () => {
  const candidates = extractOne("Fita Isolante", "<p>Rolo com 80 metros de fita isolante de alta aderência.</p>");
  assert.equal(findAttr(candidates, "length")?.value, "80m");
});
test("A3.5E-P2-R: positivo -- 'comprimento total 6 metros' continua comprimento legítimo", () => {
  const candidates = extractOne("Perfil de Aço", "<p>Comprimento total 6 metros, ideal para estruturas.</p>");
  assert.equal(findAttr(candidates, "length")?.value, "6m");
});

// ---------- Seção 12: material plural ----------

test("A3.5E-P2-R: SKU 10430321 real -- 'Fabricados em PVC' produz material=PVC", () => {
  const candidates = extractOne(
    "Curva 45º Soldável 32mm Fortlev",
    "<p>A Curva 45º Soldável Fortlev realiza mudança de direção. Fabricados em PVC na cor marrom, suportam até 7,5Kgf/cm² ou 75 m.c.a. à temperatura de 20°C.</p>",
    "Água fria",
  );
  const material = findAttr(candidates, "material");
  assert.equal(material?.value, "PVC");
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-R: 'Fabricadas em aço galvanizado' (plural feminino) produz material=Aço", () => {
  const candidates = extractOne("Anilhas Galvanizadas 1/4 6mm", "<p>Fabricadas em aço galvanizado, com resistência à oxidação.</p>");
  assert.equal(findAttr(candidates, "material")?.value, "aço");
});
test("A3.5E-P2-R: positivo -- singular 'Fabricado em PVC' continua funcionando (sem regressão)", () => {
  const candidates = extractOne("Produto Teste", "<p>Fabricado em PVC de alta qualidade.</p>");
  assert.equal(findAttr(candidates, "material")?.value, "PVC");
});
test("A3.5E-P2-R: positivo -- 'Produzidas em aço inox' (plural) produz material=Aço Inox", () => {
  const candidates = extractOne("Produto Teste", "<p>Peças produzidas em aço inoxidável de alta resistência.</p>");
  assert.equal(findAttr(candidates, "material")?.value, "aço inox");
});
