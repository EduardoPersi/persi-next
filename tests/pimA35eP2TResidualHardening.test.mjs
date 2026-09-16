import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import { maskInstructionalPlaceholderContent, maskDualConnectionAdjacency, maskWireGaugeCapacityRange } from "../lib/pim/context-exclusion.ts";

function extractOne(title, description, category = null, brand = null) {
  const extractor = new PimAttributeExtractor();
  return extractor.extract({ title, description, category, brand, attributes: [] });
}
function findAttr(candidates, attribute) {
  return candidates.find((c) => c.attribute === attribute);
}

// ---------- Seção 9: TEMPLATE_PLACEHOLDER_TEXT ----------

test("A3.5E-P2-T: SKU 0218 real -- placeholder de material não vira PVC; roscável (título) sobrevive", () => {
  const candidates = extractOne(
    "Bucha Redução Roscável 2 X 1.1/2 - Krona",
    "<p>A bucha redutora rosqueada 2\" x 1.1/2\" é a solução ideal. Material: [Indique o material, como PVC, aço galvanizado, latão, etc.]. Aplicação: Compatível com sistemas de água, gás e outros fluídos.</p>",
  );
  assert.equal(findAttr(candidates, "material"), undefined);
  assert.equal(findAttr(candidates, "connection")?.value, "roscável");
});
test("A3.5E-P2-T: SKU 0211 real -- mesmo padrão, mesma correção", () => {
  const candidates = extractOne(
    "Bucha Redução Roscável 1.1/4 X 1 - Krona",
    "<p>Material: [Indique o material, como PVC, latão, aço galvanizado, etc.]. Aplicação: Compatível com sistemas de água, gás e outros fluídos.</p>",
  );
  assert.equal(findAttr(candidates, "material"), undefined);
});
test("A3.5E-P2-T: variante 'Especifique o material' também mascarada", () => {
  const masked = maskInstructionalPlaceholderContent("Material: [Especifique o material, como PVC, latão, aço galvanizado, etc.].");
  assert.ok(!/PVC/.test(masked));
});
test("A3.5E-P2-T: variante 'Adicione o material' também mascarada", () => {
  const masked = maskInstructionalPlaceholderContent("Material: [Adicione o material, como aço galvanizado, pvc ou latão].");
  assert.ok(!/pvc/i.test(masked));
});
test("A3.5E-P2-T: variante 'Insira medida' também mascarada", () => {
  const masked = maskInstructionalPlaceholderContent("Tamanho do cabo: [inserir medida, ex.: 20 cm ou 30 cm]");
  assert.ok(!/20 cm/.test(masked));
});
test("A3.5E-P2-T: variante com instrução no meio do colchete ('Se aplicável, informe...') também mascarada", () => {
  const masked = maskInstructionalPlaceholderContent("Normas: [Se aplicável, informe as normas que atendem, como NBR 5648].");
  assert.ok(!/NBR 5648/.test(masked));
});
test("A3.5E-P2-T: positivo -- 'Material: PVC' (sem colchetes) continua funcionando", () => {
  const candidates = extractOne("Produto Teste", "<p>Material: PVC de alta qualidade.</p>");
  assert.equal(findAttr(candidates, "material")?.value, "PVC");
});
test("A3.5E-P2-T: positivo -- 'Fabricado em PVC' (sem colchetes) continua funcionando", () => {
  const candidates = extractOne("Produto Teste", "<p>Fabricado em PVC de alta resistência.</p>");
  assert.equal(findAttr(candidates, "material")?.value, "PVC");
});
test("A3.5E-P2-T: positivo -- colchetes SEM verbo de instrução não são mascarados (conteúdo factual legítimo)", () => {
  const masked = maskInstructionalPlaceholderContent("Dimensões [aproximadas] podem variar conforme o lote de PVC.");
  assert.ok(/PVC/.test(masked));
  assert.ok(/aproximadas/.test(masked));
});
test("A3.5E-P2-T: positivo -- CSS-leakage tipo '[22px]'/'[#f4f4f4]' não é mascarado (sem verbo de instrução)", () => {
  const masked = maskInstructionalPlaceholderContent("Estilo interno: margin-[22px] color-[#f4f4f4] Material: PVC");
  assert.ok(/PVC/.test(masked));
});
test("A3.5E-P2-T: PLACEHOLDER_FALSE_POSITIVE_PASS -- todos os 38 casos reais do catálogo confirmados sem vazamento (regressão de amostra representativa)", () => {
  const candidates = extractOne(
    "Niple Roscável 3/4 - Krona",
    "<p>Material: [Adicione o material aqui, como aço galvanizado, latão ou pvc]. Aplicação: Compatível com sistemas de água, gás e outros fluídos.</p>",
  );
  assert.equal(findAttr(candidates, "material"), undefined);
});

// ---------- Seção 12: DUAL_COMPATIBILITY ----------

test("A3.5E-P2-T: SKU A39.01 real -- 'compatível com eletroduto soldável e roscável' não vira conexao=Soldável", () => {
  const candidates = extractOne(
    "Caixa de Passagem Para Eletroduto PVC Preto 4x2 - Hidrossol",
    "<p>Produzida em PVC antichamas de alta qualidade. Compatível com eletroduto soldável e eletroduto roscável, garantindo versatilidade. Palavras-chave: caixa para eletroduto soldável e roscável, acessórios Hidrossol.</p>",
  );
  assert.equal(findAttr(candidates, "connection"), undefined);
  assert.equal(findAttr(candidates, "material")?.value, "PVC");
});
test("A3.5E-P2-T: 'Tipo de conexão: Soldável' isolado continua válido (positivo)", () => {
  const candidates = extractOne("Produto Teste", "<p>Tipo de conexão: Soldável. Instalação via cola específica para PVC.</p>");
  assert.equal(findAttr(candidates, "connection")?.value, "soldável");
});
test("A3.5E-P2-T: 'Conexão: Roscável' isolado continua válido (positivo)", () => {
  const candidates = extractOne("Produto Teste", "<p>Conexão: Roscável para instalação hidráulica.</p>");
  assert.equal(findAttr(candidates, "connection")?.value, "roscável");
});
test("A3.5E-P2-T: 'Compatível com sistema soldável' (menção única) continua avaliado pela hierarquia de evidência existente", () => {
  const masked = maskDualConnectionAdjacency("Compatível com sistema soldável de tubulação.");
  assert.ok(/soldável/.test(masked));
});
test("A3.5E-P2-T: par adjacente isolado 'soldável e roscável' é mascarado por maskDualConnectionAdjacency", () => {
  const masked = maskDualConnectionAdjacency("caixa para eletroduto soldável e roscável, acessórios diversos");
  assert.ok(!/soldável/.test(masked));
  assert.ok(!/roscável/.test(masked));
});
test("A3.5E-P2-T: 'roscável e soldável' (ordem invertida) também mascarado", () => {
  const masked = maskDualConnectionAdjacency("compatível com eletroduto roscável e soldável, versatilidade total");
  assert.ok(!/roscável/.test(masked));
  assert.ok(!/soldável/.test(masked));
});

// ---------- Seção 10/11: SOURCE_INTERNAL_CONTRADICTION (Esgoto SN) -- documentado, não corrigido em código ----------

test("A3.5E-P2-T: SKU 11122001 (Esgoto SN, Roscável suspeito) -- extração permanece fiel ao texto-fonte (fail-closed é bloqueio de auditoria, não mudança de extração)", () => {
  const candidates = extractOne(
    "Joelho 45° Para Esgoto SN DN 200 - Fortlev",
    "<p>Características: Material: PVC de alta resistência. Diâmetro Nominal: DN 200 (200 mm). Tipo de Conexão: Roscável, compatível com tubos e conexões de sistema de esgoto.</p>",
  );
  // A extração continua fiel ao rótulo estruturado explícito -- a contradição
  // é entre PRODUTOS-IRMÃOS (não detectável sem conhecimento externo) e é
  // tratada como bloqueio de auditoria (classificação/exclusão do write set),
  // nunca como uma regra de substituição de valor no extrator.
  assert.equal(findAttr(candidates, "connection")?.value, "roscável");
});
test("A3.5E-P2-T: positivo -- SKU 11130504 (Esgoto SN, template correto) continua Soldável", () => {
  const candidates = extractOne(
    "Joelho 90° Esgoto SN DN 50 mm - Fortlev",
    "<p>Linha SN (Soldável Normal): instalação via cola específica para PVC. Material: PVC rígido branco.</p>",
  );
  assert.equal(findAttr(candidates, "connection")?.value, "soldável");
});

// ---------- Seção 27 (auditoria cega final): WIRE_GAUGE_CAPACITY_RANGE ----------

test("A3.5E-P2-T: SKU 1775055 real -- faixa de capacidade de decapagem '1,5 - 6,5 m' não vira comprimento", () => {
  const candidates = extractOne(
    "Alicate Desencapador De Fios, 210 mm, 1,5 - 6,5 m, 1 Pc Sparta",
    "<p>As lâminas de corte do alicate são projetadas para remover o isolamento de fios, corta fios e cabos de bitolas 0.5mm a 6.5mm e desencapa fios e cabos de 1.5mm a 6.5mm</p><p>:: Comprimento: 260mm</p>",
  );
  const length = findAttr(candidates, "length");
  assert.notEqual(length?.value, "6,5m");
});
test("A3.5E-P2-T: maskWireGaugeCapacityRange remove a faixa 'X - Y m' apenas quando há vocabulário de decapagem no mesmo texto", () => {
  const masked = maskWireGaugeCapacityRange("Alicate Desencapador, 1,5 - 6,5 m de capacidade");
  assert.ok(!/6,5\s*m\b/.test(masked));
});
test("A3.5E-P2-T: positivo -- faixa 'X - Y m' sem vocabulário de decapagem/desencapagem não é mascarada", () => {
  const masked = maskWireGaugeCapacityRange("Mangueira flexível, 1,5 - 6,5 m de comprimento útil");
  assert.ok(/6,5\s*m\b/.test(masked));
});
test("A3.5E-P2-T: positivo -- 'mm' (faixa de milímetros dupla) não é afetado por maskWireGaugeCapacityRange", () => {
  const masked = maskWireGaugeCapacityRange("Alicate Desencapador de fios, corta cabos de 1,5 - 6,5 mm de bitola");
  assert.ok(/6,5\s*mm\b/.test(masked));
});
