import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import { exactRationalFromDecimalText } from "../lib/pim/rational.ts";

const extract = (title, description) =>
  new PimAttributeExtractor().extract({ productId: "p1", title, description, brand: null, category: null, sku: "SKU1", gtin: null, attributes: [] });
const find = (items, attribute) => items.find((item) => item.attribute === attribute);

// ---------- Seção 15: PRESSÃO (m.c.a.) ----------

test("A3.5E-P2-J pressão: '75 m.c.a.' isolado não produz comprimento", () => {
  const items = extract("Curva 45º Soldável 32mm Fortlev", "<p>Suporta até 7,5Kgf/cm² ou 75 m.c.a. à temperatura de 20°C.</p>");
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-J pressão: '40 mca' (sem pontos) não produz comprimento", () => {
  const items = extract("Válvula Genérica", "<p>Pressão máxima de operação: 40 mca.</p>");
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-J pressão: 'Pressão 60 m.c.a.' não produz comprimento", () => {
  const items = extract("Bomba Pressurizadora", "<p>Pressão 60 m.c.a. de altura manométrica.</p>");
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-J pressão: comprimento real convive com m.c.a. no mesmo texto (exclusão por ocorrência, não por produto)", () => {
  const items = extract("Tubo Genérico", "<p>Tubo 6 m. Pressão máxima 75 m.c.a.</p>");
  const length = find(items, "length");
  assert.ok(length, "expected a genuine comprimento=6m to survive");
  assert.equal(length.value, "6m");
});

// ---------- Seção 15: ELÉTRICA (prefixo M/k) ----------

test("A3.5E-P2-J elétrica: '1 M Ohms' não produz comprimento", () => {
  const items = extract("Multimetro Digital Plus", "<p>Impedância de entrada: 1 M Ohms em todas as escalas.</p>");
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-J elétrica: '10 MΩ' não produz comprimento", () => {
  const items = extract("Multimetro Digital", "<p>Resistência máxima: 10 MΩ.</p>");
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-J elétrica: '10 kOhm' não produz comprimento", () => {
  const items = extract("Multimetro Digital", "<p>Faixa de medição: 10 kOhm.</p>");
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-J elétrica: comprimento real de cabo convive com impedância no mesmo texto", () => {
  const items = extract("Cabo de Teste Multimetro", "<p>Cabo de teste 1 m, impedância de entrada 1 M Ohms.</p>");
  const length = find(items, "length");
  assert.ok(length, "expected a genuine comprimento=1m to survive");
  assert.equal(length.value, "1m");
});

// ---------- Seção 15: VAZÃO ----------

test("A3.5E-P2-J vazão: 'Vazão 1.200 L/h' não produz volume", () => {
  const items = extract("Filtro para Caixa d'Água", "<p>Vazão Nominal: 1.200 L/h. Grau de Filtração: Classe D.</p>");
  assert.equal(find(items, "volume"), undefined);
});

test("A3.5E-P2-J vazão: 'Vazão 20 L/min' não produz volume", () => {
  const items = extract("Bomba Genérica", "<p>Vazão máxima: 20 L/min.</p>");
  assert.equal(find(items, "volume"), undefined);
});

test("A3.5E-P2-J vazão: volume real de reservatório convive com vazão no mesmo texto", () => {
  const items = extract("Reservatório com Filtro", "<p>Reservatório 20 L. Vazão Nominal: 1.200 L/h.</p>");
  const volume = find(items, "volume");
  assert.ok(volume, "expected a genuine volume=20L to survive");
  assert.equal(volume.value, "20L");
});

// ---------- Seção 15: DECIMAL (regressão histórica, não pode quebrar) ----------

test("A3.5E-P2-J decimal: 0,625m continua 5/8 (rational.ts intacto)", () => {
  assert.deepEqual(exactRationalFromDecimalText("0,625"), { numerator: 5, denominator: 8 });
});
test("A3.5E-P2-J decimal: 1,2m continua 6/5", () => {
  assert.deepEqual(exactRationalFromDecimalText("1,2"), { numerator: 6, denominator: 5 });
});
test("A3.5E-P2-J decimal: 3,125m continua 25/8", () => {
  assert.deepEqual(exactRationalFromDecimalText("3,125"), { numerator: 25, denominator: 8 });
});

// ---------- Seção 13: MATERIAL — componente (terminal) vs. principal ----------

test("A3.5E-P2-J material: 'terminais de latão' não produz material (SKU 107376-class, corpo real não-canônico)", () => {
  const items = extract(
    "Fusível De Vidro 5A 20AG 20x4mm",
    "<ul><li><strong>Material:</strong> Vidro transparente com terminais de latão niquelado</li></ul>"
  );
  assert.equal(find(items, "material"), undefined, "should not confidently emit 'Latão' for the glass fuse's own material");
});

test("A3.5E-P2-J material: 'Cabo de Aço' continua correto (não regressão do gate de terminal)", () => {
  const items = extract("Esquadro Cabo de Aço 16\" Lotus Profissional 40cm", "<p>Esquadro Cabo de Aço para uso profissional.</p>");
  const material = find(items, "material");
  assert.ok(material, "expected material=Aço to survive for a genuine steel-cable product");
  assert.equal(material.value, "aço");
});

test("A3.5E-P2-J material: 'Bucha De Latão' continua correto (não regressão do gate de terminal)", () => {
  const items = extract("Bucha De Latão De Redução Amarela 3/4X1/2", "<p>Bucha de Latão para redução de encanamento.</p>");
  const material = find(items, "material");
  assert.ok(material, "expected material=Latão to survive for a genuine brass bushing");
  assert.equal(material.value, "latão");
});

test("A3.5E-P2-J material: caso histórico 'papel crepe com adesivo à base de borracha' (SKU 35059) permanece intacto", () => {
  const items = extract("Fita Crepe", "<p>Material: papel crepe com adesivo à base de borracha natural.</p>");
  const material = find(items, "material");
  assert.ok(material, "expected material=Borracha to still be found (no 'terminal' word present, gate does not apply)");
  assert.equal(material.value, "borracha");
});

test("A3.5E-P2-J milhar: '1.200 L/h' é excluído por contexto de vazão independentemente do valor numérico", () => {
  // The fix never needs to resolve whether "1.200" means 1200 or 1.2 --
  // the whole flow-rate occurrence is masked before any number is parsed.
  const items = extract("Produto Genérico", "<p>Vazão: 1.200 L/h.</p>");
  assert.equal(find(items, "volume"), undefined);
});
