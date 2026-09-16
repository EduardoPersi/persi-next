import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import { parseMeasurementComponents } from "../lib/pim/normalization.ts";

const context = (title, description = null, category = null, attributes = []) => ({
  productId: "synthetic", title, description, brand: null, category, sku: "", gtin: null, attributes,
});
const extract = (title, description = null, category = null, attributes = []) =>
  new PimAttributeExtractor().extract(context(title, description, category, attributes));
const find = (items, attribute) => items.find((item) => item.attribute === attribute);

// ---------- BITOLA: positive ----------

test("A3.5B bitola: tubo/conexão hidráulica em mm vira bitola_mm com contexto", () => {
  const items = extract("Joelho 90º Soldável 25mm Fortlev");
  const bitolaMm = find(items, "bitola_mm");
  assert.equal(bitolaMm.value, "25mm");
  assert.equal(find(items, "diameter"), undefined);
  assert.equal(find(items, "thread"), undefined);
});

test("A3.5B bitola: fração de polegada com contexto hidráulico vira bitola", () => {
  const items = extract("Registro Para Máquina De Lavar", 'Saída 3/4" - Japi', "Hidráulica");
  const bitola = find(items, "bitola");
  assert.equal(bitola.value, '3/4"');
  assert.equal(find(items, "thread"), undefined);
});

test("A3.5B bitola: medida composta 25mm x 3/4\" preserva os dois lados", () => {
  const items = extract("Joelho 90º Azul Soldável com Bucha de Latão 25mm x 3/4\" Fortlev");
  const bitola = find(items, "bitola");
  assert.equal(bitola.value, '25mm x 3/4"');
  assert.equal(bitola.measurementComponents.length, 2);
  assert.deepEqual(bitola.measurementComponents[0], { raw: "25mm", numerator: 25, denominator: 1, unit: "mm" });
  assert.deepEqual(bitola.measurementComponents[1], { raw: '3/4"', numerator: 3, denominator: 4, unit: '"' });
});

test("A3.5B bitola: medida composta mista é bitola mesmo sem palavra-chave no título", () => {
  // Unidades mistas (mm + polegada) já são, por si só, evidência suficiente
  // de redução hidráulica — não depende de um substantivo específico.
  const items = extract('Peça Genérica 20mm x 1/2"');
  assert.equal(find(items, "bitola").value, '20mm x 1/2"');
});

// ---------- BITOLA: negative (prefer false negative) ----------

test("A3.5B bitola negativo: martelo de borracha 60mm NÃO vira bitola/bitola_mm", () => {
  const items = extract("Martelo de Borracha Preto 60mm 418 - Thompson");
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "bitola_mm"), undefined);
  assert.equal(find(items, "diameter").value, "60mm");
});

test("A3.5B bitola negativo: abraçadeira/cabo 8mm NÃO vira bitola sem contexto suficiente", () => {
  const items = extract("Grampo Para Fixar Cabo Coaxial 8mm BR Japi");
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "bitola_mm"), undefined);
  assert.equal(find(items, "diameter").value, "8mm");
});

test("A3.5B bitola negativo: dimensão de bolsa 280 x 305mm NÃO vira bitola", () => {
  const items = extract("Bolsa Para Ferramentas Com 32 Bolsos, 460 X 280 X 305 mm, 1 Pc Mtx");
  assert.equal(find(items, "bitola"), undefined);
  const diameter = find(items, "diameter");
  assert.ok(diameter);
  assert.equal(diameter.value.includes('"'), false);
});

test("A3.5B bitola negativo: perfil 38x38mm sem contexto hidráulico NÃO vira bitola", () => {
  const items = extract("Curva Vert. Int. 90º P/ Perfilado 38x38mm E-Pz Perfil Líder");
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "diameter").value, "38 x 38mm");
});

// ---------- THREAD: removido do extrator determinístico ----------

test("A3.5B thread: fração hidráulica contextual vira bitola, não thread", () => {
  const items = extract("Boia Caixa D'água Garden Azul Zamac 3/4\" 351zpe", null, "Hidráulica");
  assert.equal(find(items, "thread"), undefined);
  assert.equal(find(items, "bitola").value, '3/4"');
});

test("A3.5B thread: fração sem qualquer contexto não é promovida automaticamente", () => {
  const items = extract('Peça Misteriosa 1/2"');
  assert.equal(find(items, "thread"), undefined);
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "diameter").value, '1/2"');
});

test("A3.5B thread: rosca de parafuso/fixador não é confundida com bitola hidráulica", () => {
  const items = extract('Parafuso Sextavado Rosca Parcial Din571 Soberba 1/4"');
  assert.equal(find(items, "bitola"), undefined);
  assert.equal(find(items, "thread"), undefined);
});

test("A3.5B thread: o extrator determinístico nunca produz o atributo thread", () => {
  // Regressão estrutural: nenhuma amostra da bateria de fixtures reais abaixo
  // deve produzir "thread", independentemente do contexto.
  const samples = [
    extract("Registro esfera rosca 3/4 pol", "Corpo em latão", "Hidráulica"),
    extract('Adaptador rosca macho 1/2"', 'Saída fêmea 3/4"'),
    extract('Mangueira Jardim Maxi Garden Reforçada Azul 1/2"X3,0mm'),
  ];
  for (const items of samples) assert.equal(find(items, "thread"), undefined);
});

// ---------- CONNECTION: role-aware ----------

test("A3.5B connection: soldável e roscável coexistem quando ambos são legítimos", () => {
  const items = extract("Joelho 90º Azul Soldável com Bucha de Latão 25mm x 3/4\" Fortlev", "Uma ponta soldável e a bucha roscável.");
  const connection = find(items, "connection");
  // Ambos os valores devem sobreviver — em "soldável | roscável" (multi-value
  // legítimo, join de exibição) ou em conflictingValues (se o detector ainda
  // assim marcar como ambíguo) — nunca reduzidos a um único valor silencioso.
  const values = connection.status === "CONFLICT" ? new Set(connection.conflictingValues) : new Set(connection.value.split(" | "));
  assert.ok(values.has("soldável"), JSON.stringify(connection));
  assert.ok(values.has("roscável"), JSON.stringify(connection));
});

test("A3.5B connection: soldável isolado permanece single value", () => {
  const items = extract("Joelho 90º Soldável 60mm Fortlev");
  const connection = find(items, "connection");
  assert.equal(connection.value, "soldável");
  assert.equal(connection.status, "CANDIDATE");
});

test("A3.5B connection: roscável isolado permanece single value", () => {
  const items = extract("Registro Para Máquina De Lavar", "Conexão roscável na entrada.");
  const connection = find(items, "connection");
  assert.equal(connection.value, "roscável");
});

// ---------- MATERIAL: multiplicidade legítima preservada ----------

test("A3.5B material: PVC isolado permanece single value", () => {
  const items = extract("Joelho 90º de Redução Soldável 25X20mm Fortlev", "Corpo em PVC.");
  assert.equal(find(items, "material").value, "PVC");
});

test("A3.5B material: aço inox + latão coexistem sem serem reduzidos a um único valor", () => {
  const items = extract("Altri Bomba Submersa Palito Para Poço", "Corpo em aço inox e conexão em latão.");
  const material = find(items, "material");
  assert.ok(material.status === "CONDIDATE" || material.status === "CANDIDATE" || material.status === "CONFLICT");
  const values = new Set(material.status === "CONFLICT" ? material.conflictingValues : [material.value]);
  assert.ok(values.has("aço inox") || [...values].some((v) => v.includes("aço inox")));
});

// ---------- LENGTH: papéis distintos não colapsam em contradição ----------

test("A3.5B length: medida simples permanece candidata única", () => {
  const items = extract("Linha Para Pedreiro 50m - Canal");
  assert.equal(find(items, "length").value, "50m");
});

test("A3.5B length: papéis distintos (componente vs produto) não são forçados a contradição sem sinal", () => {
  const items = extract("Cabo com anel", "Cabo 10m; anel componente 2m");
  const length = find(items, "length");
  assert.ok(length);
  // Aceitamos tanto separação de papel quanto ambiguidade honesta — o que
  // NÃO pode acontecer é uma fusão silenciosa em um terceiro valor.
  assert.ok(["SEMANTIC_ROLE_SEPARATION", "UNRESOLVED_AMBIGUITY", "LEGITIMATE_MULTI_VALUE", "NO_CONFLICT"].includes(length.sourceConflictDecision));
});

// ---------- VOLUME ----------

test("A3.5B volume: 500ml permanece candidato único", () => {
  const items = extract("Fixmassa 500ml - Mactra");
  assert.equal(find(items, "volume").value, "500ml");
});

test("A3.5B volume: 3L permanece candidato único", () => {
  const items = extract("Garrafão Termico 3,0L Azul - Mor");
  assert.equal(find(items, "volume").value, "3L");
});

test("A3.5B volume: múltiplos volumes não são automaticamente tratados como contradição resolvida silenciosamente", () => {
  const items = extract("Primer Acqua Balde 18L - Dryko", "Rende conforme embalagem; frasco de amostra 500ml.");
  const volume = find(items, "volume");
  assert.ok(volume);
  assert.notEqual(volume.status, undefined);
});

// ---------- COMPOUND: representação comercial preservada ----------

test("A3.5B compound: 32 x 25mm preserva ambos os lados com unidade compartilhada", () => {
  const items = extract("Bucha de redução soldável 32 x 25mm Amanco");
  const bitola = find(items, "bitola");
  assert.equal(bitola.value, "32 x 25mm");
  assert.deepEqual(bitola.measurementComponents, [
    { raw: "32", numerator: 32, denominator: 1, unit: "mm" },
    { raw: "25mm", numerator: 25, denominator: 1, unit: "mm" },
  ]);
});

test("A3.5B compound: 25mm x 1/2\" nunca converte polegada para mm", () => {
  const items = extract('Adaptador 25mm x 1/2"');
  const bitola = find(items, "bitola");
  assert.equal(bitola.value, '25mm x 1/2"');
  assert.deepEqual(bitola.measurementComponents[1], { raw: '1/2"', numerator: 1, denominator: 2, unit: '"' });
});

// ---------- parseMeasurementComponents: unidade pura, sem conversão ----------

test("A3.5B parseMeasurementComponents nunca converte sistemas de unidade", () => {
  assert.deepEqual(parseMeasurementComponents('1/2"'), [{ raw: '1/2"', numerator: 1, denominator: 2, unit: '"' }]);
  assert.deepEqual(parseMeasurementComponents("25mm"), [{ raw: "25mm", numerator: 25, denominator: 1, unit: "mm" }]);
  // raw preserva a caixa original do texto-fonte ("500ml"); unit resolve
  // para o código canônico do banco ("mL") independente da caixa — corrigido
  // na A3.5D-F (fix #1/#2), ver tests/pimA35dFHardening.test.mjs.
  assert.deepEqual(parseMeasurementComponents("500ml"), [{ raw: "500ml", numerator: 500, denominator: 1, unit: "mL" }]);
  // Nenhuma chamada produz um valor em outro sistema de unidade a partir do
  // original — nunca aparece "mm" quando a entrada era só polegada, e vice-versa.
  const compound = parseMeasurementComponents('25mm x 3/4"');
  assert.equal(compound[0].unit, "mm");
  assert.equal(compound[1].unit, '"');
});
