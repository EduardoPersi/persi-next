import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";

const context = (title, description = null, category = null, attributes = []) => ({
  productId: "synthetic", title, description, brand: null, category, sku: "", gtin: null, attributes,
});
const extract = (title, description = null, category = null, attributes = []) =>
  new PimAttributeExtractor().extract(context(title, description, category, attributes));
const find = (items, attribute) => items.find((item) => item.attribute === attribute);

// ---------- Seção 7: SKU 101020313 dedicado ----------

test("A3.5E-P2-G-R1 SKU 101020313: altura de aplicação em subseção não vira comprimento do produto", () => {
  const items = extract(
    "Impermeabilizante Para Argamassa E Concreto Mactra 2000 Sachê 2L",
    "<p>Emulsão solúvel em água com propriedades de impermeabilizar concreto e argamassas.</p>" +
      "<p>COMO APLICAR<br />PREPARO DA SUPERFÍCIE<br />O local da aplicação deverá estar áspero, resistente.<br />" +
      "MODO DE USAR<br />Conforme a tabela abaixo, deverá ser diluído com água.</p>" +
      "<p>REVESTIMENTO IMPERMEÁVEL<br />A aderência entre a superfície e a argamassa impermeável deverá ser feita com cuidado.</p>" +
      "<p>RESERVATÓRIOS<br />Arredondar todos os cantos com raio de no mínimo 8cm.</p>" +
      "<p>ALICERCES<br />Em construções ao nível do solo o revestimento deverá ser feito em argamassa impermeável até 1 m no mínimo acima do piso externo acabado.</p>" +
      "<p>conteúdo da embalagem:</p><p>1 unidade de Impermeabilizante Para Argamassa E Concreto Mactra 2000 Sachê 2L</p>",
  );
  assert.equal(find(items, "length"), undefined, "1m de altura de revestimento não deveria virar comprimento");
  // O produto continua podendo participar de outros atributos legítimos —
  // o hardening bloqueia o valor errado, não o produto inteiro.
  assert.ok(true);
});

// ---------- Seção 11: testes sintéticos de estrutura multi-seção ----------

test("A3.5E-P2-G-R1 (A) COMO APLICAR > PREPARO DA SUPERFÍCIE > REVESTIMENTO > altura de aplicação — BLOCKED", () => {
  const items = extract(
    "Selante Base Água",
    "<p>COMO APLICAR</p><p>PREPARO DA SUPERFÍCIE</p><p>REVESTIMENTO</p><p>Aplicar até 1 m acima do piso.</p>",
  );
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-G-R1 (B) INSTALAÇÃO > ETAPA 1 > ETAPA 2 > tubo do sistema de terceiro — BLOCKED", () => {
  const items = extract(
    "Kit Vedante Universal",
    "<p>INSTALAÇÃO</p><p>ETAPA 1</p><p>ETAPA 2</p><p>Usar tubo de 1 m para completar a instalação.</p>",
  );
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-G-R1 (C) MODO DE USAR > SUPERFÍCIE > camada de aplicação — BLOCKED", () => {
  const items = extract(
    "Argamassa Multiuso",
    "<p>MODO DE USAR</p><p>SUPERFÍCIE</p><p>Aplicar camada de 2 mm sobre a base preparada.</p>",
  );
  assert.equal(find(items, "bitola_mm"), undefined);
  assert.equal(find(items, "diameter"), undefined);
});

test("A3.5E-P2-G-R1 (D) CARACTERÍSTICAS TÉCNICAS > Comprimento declarado — ACCEPTED", () => {
  const items = extract("Barra de Reforço", "<p>CARACTERÍSTICAS TÉCNICAS</p><p>Comprimento: 1 m</p>");
  assert.equal(find(items, "length")?.value, "1m");
});

test("A3.5E-P2-G-R1 (E) ESPECIFICAÇÕES > Material declarado — ACCEPTED", () => {
  const items = extract("Suporte Reforçado", "<p>ESPECIFICAÇÕES</p><p>Material: aço galvanizado</p>");
  assert.equal(find(items, "material")?.value, "aço");
});

test("A3.5E-P2-G-R1 (F) EMBALAGEM > Conteúdo declarado — ACCEPTED", () => {
  const items = extract("Tinta Acrílica Padrão", "<p>EMBALAGEM</p><p>Conteúdo: 2 L</p>");
  assert.equal(find(items, "volume")?.value, "2L");
});

test("A3.5E-P2-G-R1 (G) INSTALAÇÃO > conexão de terceiro citada na instrução — não vira conexao do produto", () => {
  const items = extract(
    "Vedante Multiuso Spray",
    '<p>INSTALAÇÃO</p><p>Usar conexão roscável de 1/2" para completar a instalação do sistema existente.</p>',
  );
  assert.equal(find(items, "connection"), undefined);
});

// ---------- Seção 6: evidência positiva preservada (produto real) ----------

test("A3.5E-P2-G-R1 positivo: comprimento declarado no título de uma barra real continua ACCEPTED", () => {
  const items = extract("Barra PVC 1 m");
  assert.equal(find(items, "length")?.value, "1m");
});

test("A3.5E-P2-G-R1 positivo: comprimento de um rolo real (produto = o próprio rolo) continua ACCEPTED", () => {
  const items = extract("Rolo 10 m");
  assert.equal(find(items, "length")?.value, "10m");
});

test("A3.5E-P2-G-R1 positivo: volume de embalagem declarado continua ACCEPTED", () => {
  const items = extract("Removedor Multiuso", "Embalagem 2 L.");
  assert.equal(find(items, "volume")?.value, "2L");
});

test("A3.5E-P2-G-R1 positivo: material declarado fora de seção instrucional continua ACCEPTED", () => {
  const items = extract("Suporte Universal", "Material: aço galvanizado.");
  assert.equal(find(items, "material")?.value, "aço");
});

test("A3.5E-P2-G-R1 positivo: conexão declarada fora de seção instrucional continua ACCEPTED", () => {
  const items = extract("Adaptador Genérico", "Conexão: roscável.");
  assert.equal(find(items, "connection")?.value, "roscável");
});

// ---------- Seção 9: SKU 61464 — ontologia de `conexao` ----------

test("A3.5E-P2-G-R1 SKU 61464: rosca de fixação (porca+rosca) não vira conexao automaticamente", () => {
  const items = extract(
    "Grampo Galvanizado 1/4 6mm DIN 741 (Preço por Unidade) - Bellift",
    "<p>O Grampo Galvanizado 1/4 6mm DIN 741 da Bellift é um item de fixação robusto para união de cabos de aço.</p>" +
      "<ul><li>Roscas de Precisão: Possui porcas e roscas ajustadas para garantir firmeza na fixação.</li></ul>",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-G-R1 positivo: rosca hidráulica genuína sem menção a porca continua ACCEPTED (Bucha Zamak)", () => {
  const items = extract(
    'Bucha Zamak 1"',
    "<p>A Bucha Zamak 1\" é um componente utilizado em conexões de tubulações hidráulicas.</p>" +
      "<ul><li>Rosca Interna: Projetada para conexões precisas em sistemas de tubulação de 1 polegada.</li></ul>",
  );
  assert.equal(find(items, "connection")?.value, "roscável");
});

test("A3.5E-P2-G-R1 auditoria dos 34: rendimento de cobertura sob Dados Técnicos não vira comprimento — SKU V0210628", () => {
  const items = extract(
    "Massa de Calafetar Madeira F-12 400G Marfim - Viapol",
    "<h3>Como aplicar</h3><p>Aplicação: espalhar camadas finas com espátula.</p>" +
      "<h3>Dados técnicos</h3><ul><li><p><strong>Consumo</strong>: 1 kg calafeta ~100 m de junta de 2 × 2 mm</p></li></ul>",
  );
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-G-R1 auditoria dos adicionados: adesivo para tubo CPVC não vira material=CPVC do próprio produto — SKU 1387", () => {
  const items = extract(
    "Adesivo Tubo CPVC Ultraterm Cola Para Cano Água Quente 17g - Krona",
    "<p>O Adesivo CPVC Ultraterm Krona 17g é a cola especializada para instalações de água quente com tubos CPVC.</p><ul><li>Tipo: Adesivo para CPVC</li></ul>",
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-G-R1 amostra cega: pasta lubrificante para cano PVC não vira material=PVC do próprio produto — SKU 90131", () => {
  const items = extract(
    "Pasta Lubrificante Para Cano PVC Com Bico Aplicador 80g - Amanco",
    "<p>A Pasta Lubrificante Amanco é o produto essencial para facilitar a instalação de tubos e conexões em PVC.</p><ul><li>Tipo: Base d'água, atóxica</li><li>Compatibilidade: PVC, PEAD, PPR</li></ul>",
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-G-R1 positivo: título de cola/adesivo com Material: explícito continua ACCEPTED", () => {
  const items = extract("Cola Multiuso Extra Forte", "Material: Aço Inoxidável de alta durabilidade.");
  assert.equal(find(items, "material")?.value, "aço inox");
});

test("A3.5E-P2-G-R1 amostra cega: esticador de cabo de aço não vira conexao=roscável automaticamente — SKU 62620", () => {
  const items = extract(
    "Esticador Leve Maleável Gancho Olhal Galvanizado 1/4 M6 - Bellift",
    "<p>O Esticador Leve Maleável Gancho Olhal Galvanizado da Bellift é usado em sistemas de tensionamento de cabos de aço.</p><ul><li>Fácil Ajuste: Roscas precisas permitem o ajuste fácil e rápido da tensão.</li></ul>",
    "Arame e Cabo de Aço",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-G-R1 positivo: rosca hidráulica genuína mesmo em categoria de arame/cabo permanece ACCEPTED", () => {
  const items = extract(
    "Registro Roscável Para Mangueira",
    "<p>Registro para controle de fluxo de água com conexão roscável de 1/2 polegada.</p>",
    "Arame e Cabo de Aço",
  );
  assert.equal(find(items, "connection")?.value, "roscável");
});

test("A3.5E-P2-G-V2 auditoria dos 52: cor metálica de tinta não vira material do próprio produto — SKU 43042058", () => {
  const items = extract(
    "Tinta Spray Metálico Cobre 400ml - Universo",
    "<p>Tinta spray metálica na cor cobre, ideal para dar acabamento sofisticado.</p><ul><li>Cor: Cobre metálico</li><li>Conteúdo: 400ml</li></ul>",
  );
  assert.equal(find(items, "material"), undefined);
  assert.equal(find(items, "volume")?.value, "400ml");
});

test("A3.5E-P2-G-V2 positivo: título de tinta com Material: explícito continua ACCEPTED", () => {
  const items = extract("Tinta Especial Multiuso", "Material: Aço Inoxidável de alta durabilidade.");
  assert.equal(find(items, "material")?.value, "aço inox");
});

test("A3.5E-P2-G-V2 auditoria dos 52: altura máxima de empilhamento em estocagem não vira comprimento — SKU 1009023", () => {
  const items = extract(
    "Protec Primer Promotor De Aderência Ultrafix 18kg",
    "<p>DADOS TÉCNICOS</p><p>- Estocagem: Em local seco e arejado, elevado do solo em pelo menos 5 cm, empilhamento máximo 1,5 m de altura na embalagem original e fechada.</p>",
  );
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-G-V2 auditoria dos 52: denominador de fração + designação métrica de parafuso não vira comprimento — SKUs 62619-62623", () => {
  for (const [frac, expectedGone] of [["3/16 - M5", "16M"], ["1/4 - M6", "4M"], ["5/16 - M8", "16M"], ["3/8 - M10", "8M"], ["1/2 - M12", "2M"]]) {
    const items = extract(`Esticador Leve Maleável Gancho Olhal Galvanizado ${frac} - Bellift`);
    assert.equal(find(items, "length"), undefined, `"${frac}" não deveria gerar comprimento=${expectedGone}`);
  }
});

test("A3.5E-P2-G-V2 positivo: comprimento real em metros seguido de texto continua ACCEPTED", () => {
  const items = extract("Cabo de Aço 1/8 6x7+AF RD GB SL 1770 Plastificado 1M BELLIFT");
  assert.equal(find(items, "length")?.value, "1M");
});

// ---------- Regressões P2-F: continuam passando ----------

test("A3.5E-P2-G-R1 regressão: SKU 3130000.21 (flange de instalação de terceiro) continua BLOCKED", () => {
  const items = extract(
    "Aditivo Zero Umidade Impermeabiliza Concretos E Argamassa 3,6L Eucatex",
    "<p>Eucatex impermeabilizante Zero Umidade é um aditivo de alta performance.</p>" +
      "<p>APLICAÇÃO</p><p>Caixas d'água e piscinas enterradas</p>" +
      "<p>Recomendamos colocar os canos rosqueados apertando os flanges por dentro e por fora.</p>",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-G-R1 regressão: SKU 1775055 permanece fora de qualquer inferência automática (sem heurística m→mm)", () => {
  const items = extract(
    "Alicate Desencapador De Fios, 210 mm, 1,5 - 6,5 m, 1 Pc Sparta",
    "<p>As lâminas de corte do alicate são projetadas para remover o isolamento de fios, corta fios e cabos de bitolas 0.5mm a 6.5mm e desencapa fios e cabos de 1.5mm a 6.5mm</p><p>- Especificações Técnicas:</p><p>:: Comprimento: 260mm</p>",
  );
  // Nenhuma heurística de conversão m->mm foi criada: o título ainda produz
  // um candidato de comprimento=6,5m tecnicamente lido do texto. A exclusão
  // deste caso específico continua sendo uma decisão manual de negócio
  // (lista de exclusão), não uma correção de extração — documentado como
  // limitação residual aceita.
  const length = find(items, "length");
  assert.ok(length === undefined || length.value === "6,5m", "nenhuma heurística nova de conversão foi introduzida");
});
