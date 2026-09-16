import test from "node:test";
import assert from "node:assert/strict";
import { formatRationalForDisplay, exactRationalFromDecimalText } from "../lib/pim/rational.ts";

// ---------- Seção 25: display de measurement ----------

test("A3.5E-P2-J display: 5/8 m -> '0,625 m'", () => {
  assert.equal(formatRationalForDisplay(5, 8, "m"), "0,625 m");
});
test("A3.5E-P2-J display: 6/5 m -> '1,2 m'", () => {
  assert.equal(formatRationalForDisplay(6, 5, "m"), "1,2 m");
});
test("A3.5E-P2-J display: 3/2 m -> '1,5 m'", () => {
  assert.equal(formatRationalForDisplay(3, 2, "m"), "1,5 m");
});
test("A3.5E-P2-J display: 25/8 m -> '3,125 m'", () => {
  assert.equal(formatRationalForDisplay(25, 8, "m"), "3,125 m");
});
test("A3.5E-P2-J display: 18/5 L -> '3,6 L'", () => {
  assert.equal(formatRationalForDisplay(18, 5, "L"), "3,6 L");
});
test("A3.5E-P2-J display: valor inteiro (denominator=1) não ganha vírgula espúria", () => {
  assert.equal(formatRationalForDisplay(75, 1, "m"), "75 m");
});
test("A3.5E-P2-J display: round-trip com exactRationalFromDecimalText para todos os exemplos obrigatórios", () => {
  for (const [text, unit] of [["0,625", "m"], ["1,2", "m"], ["1,5", "m"], ["3,125", "m"], ["3,6", "L"], ["0,9", "L"], ["1,3", "L"]]) {
    const { numerator, denominator } = exactRationalFromDecimalText(text);
    const display = formatRationalForDisplay(numerator, denominator, unit);
    assert.equal(display, `${text} ${unit}`);
  }
});
test("A3.5E-P2-J display: nunca arredonda -- lança erro em vez de aproximar um denominador não-terminante", () => {
  // 1/3 has an infinitely repeating decimal expansion -- this can never be
  // produced by exactRationalFromDecimalText from a real catalog value, but
  // the formatter itself must fail closed rather than silently round it.
  assert.throws(() => formatRationalForDisplay(1, 3, "m"));
});
test("A3.5E-P2-J display: sinal negativo preservado", () => {
  assert.equal(formatRationalForDisplay(-5, 8, "m"), "-0,625 m");
});

// ---------- Seção 26: serialização BigInt segura ----------

test("A3.5E-P2-J BigInt: numerator/denominator nunca são BigInt no boundary JSON (contrato do tipo)", () => {
  // exactRationalFromDecimalText's own return type is {numerator: number,
  // denominator: number} -- never bigint -- so JSON.stringify at any DTO
  // boundary built from its output is safe by construction. This test
  // proves it concretely for the exact examples this round audited.
  for (const text of ["0,625", "1,2", "3,125", "3,6"]) {
    const result = exactRationalFromDecimalText(text);
    assert.equal(typeof result.numerator, "number");
    assert.equal(typeof result.denominator, "number");
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});
test("A3.5E-P2-J BigInt: JSON.stringify de um numerator/denominator BigInt real lançaria (prova do risco documentado)", () => {
  // Demonstrates, for the record, exactly the failure this round's report
  // warns about -- a raw BigInt (as Drizzle's bigint-mode column type would
  // return if a future read ever used the query-builder path directly)
  // cannot cross a JSON boundary at all. No code in this repo does this
  // today (confirmed by the A3.5E-P2-I code audit: every existing read goes
  // through raw SQL, which returns strings, not native BigInt) -- this test
  // exists so the risk stays covered if that ever changes.
  const unsafe = { numerator: BigInt(5), denominator: BigInt(8) };
  assert.throws(() => JSON.stringify(unsafe), TypeError);
});
test("A3.5E-P2-J BigInt: convenção seura seria stringificar explicitamente, nunca depender de coerção implícita", () => {
  const bigNumerator = BigInt("9223372036854775807"); // near bigint max -- would lose precision as Number
  const safeString = bigNumerator.toString();
  assert.equal(safeString, "9223372036854775807");
  assert.doesNotThrow(() => JSON.stringify({ numerator: safeString }));
  // Demonstrates why silent Number() coercion is unsafe for values outside
  // Number.MAX_SAFE_INTEGER -- this repo's own rational.ts already guards
  // against this exact case (exactRationalFromDecimalText's MAX_SAFE check).
  assert.ok(bigNumerator > BigInt(Number.MAX_SAFE_INTEGER));
});
