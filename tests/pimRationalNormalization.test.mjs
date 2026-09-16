import test from "node:test";
import assert from "node:assert/strict";
import { exactRationalFromDecimalText } from "../lib/pim/rational.ts";
import { parseMeasurementComponents } from "../lib/pim/normalization.ts";

// ---------- Seção 7: exemplos obrigatórios ----------

test("A3.5E-P2-H-R2A: exemplos obrigatórios de conversão decimal -> racional exata", () => {
  const cases = [
    ["0.625", 5, 8], ["0,625", 5, 8],
    ["1.2", 6, 5], ["1,2", 6, 5],
    ["1.5", 3, 2], ["1,5", 3, 2],
    ["3.125", 25, 8],
    ["3.6", 18, 5],
    ["0.9", 9, 10],
    ["1.3", 13, 10],
    ["625", 625, 1],
    ["1.50", 3, 2],
    ["0.000", 0, 1],
  ];
  for (const [input, expectedNum, expectedDen] of cases) {
    const { numerator, denominator } = exactRationalFromDecimalText(input);
    assert.equal(numerator, expectedNum, `numerator for "${input}"`);
    assert.equal(denominator, expectedDen, `denominator for "${input}"`);
  }
});

test("A3.5E-P2-H-R2A: fração sempre reduzida ao menor termo (gcd=1)", () => {
  const cases = ["0.625", "1.2", "1.5", "3.125", "3.6", "0.9", "1.3", "1.50", "36.0", "100.00"];
  for (const input of cases) {
    const { numerator, denominator } = exactRationalFromDecimalText(input);
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    assert.equal(gcd(Math.abs(numerator), denominator), 1, `not reduced: "${input}" -> ${numerator}/${denominator}`);
  }
});

test("A3.5E-P2-H-R2A: denominador nunca é zero e é sempre positivo", () => {
  for (const input of ["0.625", "625", "0.000", "1.5", "-2.5"]) {
    const { denominator } = exactRationalFromDecimalText(input);
    assert.ok(denominator > 0, `denominator for "${input}" must be > 0`);
  }
});

test("A3.5E-P2-H-R2A: sinal negativo preservado quando aplicável", () => {
  assert.deepEqual(exactRationalFromDecimalText("-2.5"), { numerator: -5, denominator: 2 });
  assert.deepEqual(exactRationalFromDecimalText("-3"), { numerator: -3, denominator: 1 });
});

test("A3.5E-P2-H-R2A: zeros à esquerda e à direita são tratados corretamente", () => {
  assert.deepEqual(exactRationalFromDecimalText("007"), { numerator: 7, denominator: 1 });
  assert.deepEqual(exactRationalFromDecimalText("07.50"), { numerator: 15, denominator: 2 });
  assert.deepEqual(exactRationalFromDecimalText("0.000"), { numerator: 0, denominator: 1 });
});

test("A3.5E-P2-H-R2A: rejeita entradas inválidas sem inventar um valor", () => {
  for (const bad of ["", "abc", "1.2.3", "1,2,3", "NaN", "Infinity", "1..5", ".5", "5."]) {
    assert.throws(() => exactRationalFromDecimalText(bad), undefined, `should reject "${bad}"`);
  }
});

test("A3.5E-P2-H-R2A: nunca produz numerator/denominator não inteiro (proteção de tipo)", () => {
  for (const input of ["0.625", "1.2", "3.6", "0.9", "1.3", "3.125", "625"]) {
    const { numerator, denominator } = exactRationalFromDecimalText(input);
    assert.ok(Number.isInteger(numerator), `numerator for "${input}" must be an integer`);
    assert.ok(Number.isInteger(denominator), `denominator for "${input}" must be an integer`);
  }
});

// ---------- Integração com parseMeasurementComponents (SKUs reais afetados) ----------

test("A3.5E-P2-H-R2A: SKU MOD625 (0,625m) produz componente com numerator/denominator inteiros", () => {
  const [component] = parseMeasurementComponents("0,625m");
  assert.deepEqual(component, { raw: "0,625m", numerator: 5, denominator: 8, unit: "m" });
});

test("A3.5E-P2-H-R2A: SKU 501-style (3,6L) produz componente com numerator/denominator inteiros", () => {
  const [component] = parseMeasurementComponents("3,6L");
  assert.deepEqual(component, { raw: "3,6L", numerator: 18, denominator: 5, unit: "L" });
});

test("A3.5E-P2-H-R2A: valor inteiro (75m) continua com denominador 1, sem alteração de comportamento", () => {
  const [component] = parseMeasurementComponents("75m");
  assert.deepEqual(component, { raw: "75m", numerator: 75, denominator: 1, unit: "m" });
});

test("A3.5E-P2-H-R2A: não altera a representação de unidade — 0,625m continua unit=m, não vira 625mm", () => {
  const [component] = parseMeasurementComponents("0,625m");
  assert.equal(component.unit, "m");
});
