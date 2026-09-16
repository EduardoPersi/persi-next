import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import { maskReferenceCodeMisreadAsMeasurement } from "../lib/pim/context-exclusion.ts";

function extractOne(title, description) {
  const extractor = new PimAttributeExtractor();
  return extractor.extract({ title, description, category: null, brand: "Astra", attributes: [] });
}
function findAttr(candidates, attribute) {
  return candidates.find((c) => c.attribute === attribute);
}

// ---------- REFERENCE_CODE_SLASH_M_MISREAD_AS_LENGTH ----------

test("A3.5E-P2-W: SKU C/2019M real -- código de referência não vira comprimento=2019m", () => {
  const candidates = extractOne(
    "Tubo PEX Sr. 5 20x16,2mm - Astra (Preço Por Metro)",
    "<p>O Tubo PEX Sr. 5 20x16,2mm da Astra é uma solução moderna para sistemas hidráulicos.</p><p>Referência:C/2019M</p>",
  );
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-W: SKU C/1618M real -- mesmo padrão, mesma correção", () => {
  const candidates = extractOne(
    "Tubo PEX Sr. 5 16x12,4mm - Astra (Preço Por Metro)",
    "<p>O Tubo PEX Sr. 5 16x12,4mm da Astra é um tubo flexível e resistente.</p><p>Referência:C/1618M</p><p>Marca: ASTRA</p>",
  );
  assert.equal(findAttr(candidates, "length"), undefined);
});
test("A3.5E-P2-W: variante sem prefixo de letra (Referência:/900M) também mascarada", () => {
  const masked = maskReferenceCodeMisreadAsMeasurement("Referência:/900M");
  assert.ok(!/900M/.test(masked));
});
test("A3.5E-P2-W: positivo -- 'Comprimento: 25 metros' explícito não é afetado pela máscara de referência", () => {
  const candidates = extractOne(
    "Conduíte Espiral Reforçado PVC Preto 1/2\"x25m",
    "<p>Medidas: 1/2\" (16 mm) de diâmetro x 25 m de comprimento.</p><p>Referência:002215</p>",
  );
  assert.equal(findAttr(candidates, "length")?.value, "25m");
});
test("A3.5E-P2-W: positivo -- referência puramente numérica (sem barra+M) não é mascarada", () => {
  const masked = maskReferenceCodeMisreadAsMeasurement("Referência:151");
  assert.ok(/151/.test(masked));
});
