import test from "node:test";
import assert from "node:assert/strict";
import { PimAttributeExtractor } from "../lib/pim/extractor.ts";
import { extractMeasurements } from "../lib/pim/normalization.ts";
import { detectDataIntegritySuspicion } from "../lib/pim/data-integrity.ts";

const context = (title, description = null, category = null, attributes = []) => ({
  productId: "synthetic", title, description, brand: null, category, sku: "", gtin: null, attributes,
});
const extract = (title, description = null, category = null, attributes = []) =>
  new PimAttributeExtractor().extract(context(title, description, category, attributes));
const find = (items, attribute) => items.find((item) => item.attribute === attribute);

// ---------- MATERIAL: negativos reais do P2 (regressão obrigatória) ----------

test("A3.5E-P2-F material negativo: ferramenta de aplicação (desempenadeira de aço inox) — SKU 157053783/TX1925", () => {
  const items = extract(
    "Massa Cimento Queimado Perolizado Fosco Rose Gold 3,7 Kg Eucatex",
    "<p>É uma massa para uso externo e interno de fácil aplicação.</p><p>APLICAÇÃO</p><p>Desempenadeira de aço inox com cantos arredondados</p>",
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-F material negativo: ferramenta de instalação (martelo de borracha) — SKU 000000000006054227", () => {
  const items = extract(
    "Argamassa Cerâmica Interna AC1 20kg - Votorantim",
    "<p>Assente as peças sobre a argamassa ainda úmida e pegajosa, ajustando com leve batida de martelo de borracha para garantir nivelamento.</p>",
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-F material negativo: proibição (não use esponja de aço) — SKU TAJ/AS*BR1", () => {
  const items = extract(
    "Assento Sanitario Almofadado Slim Branco Astra",
    "<p>Para manter seu assento com boa aparência, faça sua limpeza usando apenas uma esponja ou pano macio.</p><p>Não use saponáceos, álcool, esponja de aço, detergentes fortes ou produtos químicos agressivos.</p>",
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-F material negativo: composição química (silicatos de cálcio, alumínio e ferro) — SKU CIMENTUPI50", () => {
  const items = extract(
    "Cimento CP2 CP II E 32 Saco De 50kg Tupi",
    "<p>Ele é composto por silicatos de cálcio, alumínio e ferro, sulfato de cálcio, filler carbonático e material pozolânico.</p>",
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-F material negativo: tabela de acessório/modelo compatível (coluna Material)", () => {
  const items = extract(
    "Monitor de Nível Clip CLPN",
    '<p>Relé de controle digital para reservatórios.</p><table><thead><tr><td>Modelo</td><td>Material</td></tr></thead><tbody><tr><td>050502MN005</td><td>Inox 303/304</td></tr></tbody></table>',
  );
  assert.equal(find(items, "material"), undefined);
});

test("A3.5E-P2-F contexto local: ocorrência negativa não suprime ocorrência positiva independente", () => {
  const items = extract(
    "Ferramenta Multiuso",
    "<p>Material: Aço de alta resistência.</p><p>Não use esponja de aço para limpar a superfície.</p>",
  );
  assert.equal(find(items, "material")?.value, "aço");
});

// ---------- MATERIAL: subtipo mais específico vence ----------

test("A3.5E-P2-F material: aço inoxidável (forma adjetiva) resolve para o valor canônico 'aço inox'", () => {
  const items = extract("Suporte Inox", "Material: Aço Inoxidável de alta durabilidade.");
  assert.equal(find(items, "material")?.value, "aço inox");
});

// ---------- CONEXAO: negativos reais do P2 ----------

test("A3.5E-P2-F conexao negativo: propriedade mecânica (resistência à compressão) — SKU 101020313/1009018-1600", () => {
  const items = extract(
    "Impermeabilizante Para Argamassa E Concreto Mactra 2000 Sachê 2L",
    "<p>VANTAGENS<br />Ótima resistência à compressão; Fórmula mineral, não perde suas propriedades com o tempo.</p>",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-F conexao negativo: objeto soldado não é tipo de conexão (corrente soldável) — SKU 9740", () => {
  const items = extract(
    "Corrente Soldável Zincada 5mm (Por Metro) - São Raphael",
    "<p>Tipo de elo: Soldado, proporcionando maior resistência mecânica.</p>",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-F conexao negativo: rosca de acessório compatível não é conexão do produto principal — SKU 050501MN001-1", () => {
  const items = extract(
    "Monitor de Nível Clip CLPN",
    '<p>Relé de controle digital para reservatórios, cisternas e sistemas industriais.</p><table><thead><tr><td>Modelo</td><td>Rosca</td></tr></thead><tbody><tr><td>050502MN005</td><td>3/4" BSP</td></tr></tbody></table>',
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-F conexao: hidráulica genuína sem palavra HYDRAULIC_TERMS continua funcionando (Adaptador Soldável)", () => {
  const items = extract('Adaptador Soldável 25X3/4"', 'Conexão soldável com diâmetro de 25mm x 3/4" em PVC.');
  assert.equal(find(items, "connection")?.value, "soldável");
});

// ---------- COMPRIMENTO: área não é comprimento ----------

test("A3.5E-P2-F comprimento negativo: rendimento em m² não vira comprimento — SKU SV2001", () => {
  const items = extract(
    "Tinta Acrílica Villavinil 18L Branca Interna e Externa - Spartex",
    "Rendimento: Até 320 m² por demão (dependendo da superfície)",
  );
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-F unidade de área/volume nunca é tokenizada como comprimento (m², m2, cm², mm², m³)", () => {
  for (const raw of ["10 m²", "25m2", "320 m²", "1,5 m²", "0,5m²", "40 cm²", "8mm²", "2 m³", "5cm³"]) {
    const measurements = extractMeasurements(`Rendimento de ${raw} por demão`);
    assert.equal(measurements.length, 0, `"${raw}" não deveria ser tokenizado como medida linear`);
  }
});

test("A3.5E-P2-F comprimento negativo: dimensão de acessório compatível não é comprimento do produto — SKU 3885", () => {
  const items = extract(
    "Aplicador De Fita Adesiva - Lotus",
    "<h2>Aplicador de Fita Adesiva para Rolos até 50 mm e 50 m com Cortador Dentado</h2><p>Compatível com rolos de até 50 mm de largura e 50 metros de comprimento, proporciona agilidade.</p>",
  );
  assert.equal(find(items, "length"), undefined);
});

test("A3.5E-P2-F conexao positivo real: rosca do próprio produto sobrevive mesmo com cláusula de compatibilidade depois", () => {
  const items = extract(
    "Torneira Jardim 3130 C32 - Stoc",
    "Fabricada em material de alta durabilidade. Bico de rosca compatível com engates rápidos.",
  );
  assert.equal(find(items, "connection")?.value, "roscável");
});

test("A3.5E-P2-F conexao negativo: rosca de fixador (parafuso) não é conexão hidráulica — SKU 6REVPARAF-TA25", () => {
  const items = extract(
    "Parafuso Ponta Agulha Para Drywall - (GN25) - 3,5X25mm Caixa Com 1000 - Multiperfil",
    "Rosca simples para perfuração rápida. Uso profissional em construções a seco.",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-F conexao negativo: cabeça flangeada de parafuso não é flange hidráulico — SKU 0175045060", () => {
  const items = extract(
    "Parafuso Para Madeira Rosca Parcial Flangeado Phillips Biocromatizado 4,5X60mm - Wurth",
    "Cabeça flangeada com encaixe Phillips. Acabamento biocromatizado: alta proteção contra corrosão.",
  );
  assert.equal(find(items, "connection"), undefined);
});

test("A3.5E-P2-F comprimento positivo real continua funcionando — SKU 7742", () => {
  const items = extract('Cabo Flexível Verde 750v 4,00 Mm 100m - Megatron', "Volume: 100 metros");
  assert.equal(find(items, "length")?.value, "100m");
});

// ---------- POSITIVOS OBRIGATÓRIOS (material/conexao/comprimento/volume) ----------

test("A3.5E-P2-F material positivo real continua funcionando — SKU 12957 (Material: label)", () => {
  const items = extract(
    "Bucha De Latão De Redução Amarela  3/4X1/2 - Metais Rei",
    "<ul><li>Material: Latão de alta resistência</li></ul>",
  );
  assert.equal(find(items, "material")?.value, "latão");
});

test("A3.5E-P2-F conexao positivo real continua funcionando — Luva Roscável Para Eletroduto", () => {
  const items = extract('Luva Roscavel Para Eletroduto PVC 1" Preta Hidrossol');
  assert.equal(find(items, "connection")?.value, "roscável");
});

test("A3.5E-P2-F volume positivo real continua funcionando — SKU 112567", () => {
  const items = extract("Inseticida Mata Barata E Formiga Spray 350ml - Pro Inset", "Embalagem de 350ml, prática para manuseio.");
  assert.equal(find(items, "volume")?.value, "350ml");
});

test("A3.5E-P2-F volume positivo real continua funcionando — SKU 2070089 (500L)", () => {
  const items = extract("Tanque PE Azul Fortlev 500l H0,66", "O Tanque Fortlev 500 litros é a solução ideal para armazenar água.");
  assert.equal(find(items, "volume")?.value, "500L");
});

// ---------- DATA INTEGRITY SUSPECTED ----------

test("A3.5E-P2-F data integrity: descrição de produto totalmente diferente é sinalizada — SKU 112471", () => {
  const signal = detectDataIntegritySuspicion(
    "Varal De Chão Japonês 1,40m Com Abas Osaka - Overtime",
    "<p>A Fita Isolante Adere 20 metros é ideal para aplicações elétricas que exigem maior extensão e resistência. Fabricada com PVC de alta qualidade, oferece excelente isolação, aderência e durabilidade, sendo indicada para uso profissional e residencial.</p>",
  );
  assert.equal(signal.suspected, true);
});

test("A3.5E-P2-F data integrity: não sinaliza falso positivo quando a descrição fala do próprio produto", () => {
  const signal = detectDataIntegritySuspicion(
    "Bucha De Latão De Redução Amarela  3/4X1/2 - Metais Rei",
    "Ideal para instalações hidráulicas, a Bucha de Latão de Redução oferece resistência e durabilidade, garantindo uma conexão segura entre diferentes tamanhos de tubos.",
  );
  assert.equal(signal.suspected, false);
});

test("A3.5E-P2-F data integrity: descrição curta/ausente nunca é auto-bloqueada", () => {
  assert.equal(detectDataIntegritySuspicion("Produto Genérico", null).suspected, false);
  assert.equal(detectDataIntegritySuspicion("Produto Genérico", "<p>Ok.</p>").suspected, false);
});

// ---------- Regressões pré-existentes continuam passando ----------

test("A3.5E-P2-F regressão: bitola_mm com contexto hidráulico continua íntegra", () => {
  const items = extract("Joelho 90º Soldável 25mm Fortlev");
  assert.equal(find(items, "bitola_mm")?.value, "25mm");
  assert.equal(find(items, "thread"), undefined);
});

test("A3.5E-P2-F regressão: martelo de borracha na TÍTULO continua extraindo o material do próprio produto", () => {
  const items = extract("Martelo de Borracha Preto 60mm 418 - Thompson");
  assert.equal(find(items, "material")?.value, "borracha");
});
