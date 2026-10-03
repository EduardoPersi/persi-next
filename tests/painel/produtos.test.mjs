import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

// O que se prova aqui é o CONTRATO com o painel de atendimento: quem entra,
// o que sai, e em que unidade. Errar aqui não dá erro em lugar nenhum — vira
// um preço errado no WhatsApp de um cliente, por escrito, assinado pela loja.
import { chaveConfere } from "../../lib/painel/chave.ts";
import { emCentavos, paraOPainel } from "../../lib/painel/produtos.ts";

const CHAVE = "chave-do-painel-de-teste-com-tamanho";

const produtoCru = (extra = {}) => ({
  id: 42,
  slug: "cimento-cp-ii-50kg",
  name: "Cimento CP II 50kg",
  permalink: "https://antigo.wordpress.local/?p=42",
  sku: "CIM-50",
  shortDescription: "",
  description: "",
  price: 38.9,
  regularPrice: 38.9,
  currencyCode: "BRL",
  currencySymbol: "R$",
  currencyMinorUnit: 2,
  images: [],
  categories: [],
  brands: [],
  available: true,
  stockStatus: "instock",
  averageRating: 0,
  reviewCount: 0,
  featured: false,
  onSale: false,
  attributes: [],
  variations: [],
  ...extra,
});

// ---------------------------------------------------------------- a chave
test("sem PAINEL_API_KEY no ambiente, NADA passa", () => {
  delete process.env.PAINEL_API_KEY;
  // O erro perigoso seria o contrário: site sem chave deixando entrar quem
  // mandasse o cabeçalho vazio. Um site recém-publicado ficaria com o
  // catálogo e os preços abertos para a internet inteira.
  assert.equal(chaveConfere(""), false);
  assert.equal(chaveConfere(null), false);
  assert.equal(chaveConfere("qualquer-coisa"), false);
});

test("a chave certa passa e a errada não", () => {
  process.env.PAINEL_API_KEY = CHAVE;
  assert.equal(chaveConfere(CHAVE), true);
  assert.equal(chaveConfere(CHAVE + "x"), false);
  assert.equal(chaveConfere(CHAVE.slice(0, -1)), false);
  assert.equal(chaveConfere(CHAVE.toUpperCase()), false);
});

test("chave de tamanho diferente não estoura a comparação", () => {
  process.env.PAINEL_API_KEY = CHAVE;
  // `timingSafeEqual` LANÇA quando os dois lados têm tamanhos diferentes. É
  // por isso que os dois viram hash antes: sem o hash, mandar uma chave de
  // um caractere derrubaria a rota com 500 em vez de responder 401.
  assert.doesNotThrow(() => chaveConfere("x"));
  assert.equal(chaveConfere("x"), false);
  assert.equal(chaveConfere("x".repeat(5000)), false);
});

test("a chave do painel é OUTRA, e não a do webhook do site", () => {
  process.env.PAINEL_API_KEY = CHAVE;
  process.env.SITE_WEBHOOK_KEY = "chave-do-webhook-que-nao-serve-aqui";
  assert.equal(chaveConfere(process.env.SITE_WEBHOOK_KEY), false);

  // E a do webhook NÃO serve de reserva quando a do painel falta. Com reserva,
  // quem tem a chave de mandar mensagem ganharia de brinde o catálogo com
  // preço — e trocar uma das duas por causa de um vazamento derrubaria a
  // outra, que não tinha nada a ver.
  delete process.env.PAINEL_API_KEY;
  assert.equal(chaveConfere(process.env.SITE_WEBHOOK_KEY), false);
  process.env.PAINEL_API_KEY = CHAVE;
});

// --------------------------------------------------------------- o dinheiro
test("preço vai em centavos inteiros, nunca em ponto flutuante", () => {
  assert.equal(emCentavos(38.9), 3890);
  // O caso que arredonda errado em ponto flutuante: 19.99 * 100 dá
  // 1998.9999999999998, e um `Math.trunc` entregaria R$ 19,98 ao cliente.
  assert.equal(emCentavos(19.99), 1999);
  assert.equal(emCentavos(0), 0);
  assert.equal(emCentavos(null), null);
  assert.equal(emCentavos(undefined), null);
});

test("o produto sai na forma que o painel espera", () => {
  const p = paraOPainel(produtoCru(), "https://persimateriais.com.br/");
  assert.equal(p.nome, "Cimento CP II 50kg");
  assert.equal(p.sku, "CIM-50");
  assert.equal(p.preco_centavos, 3890);
  assert.equal(p.disponivel, true);
  assert.equal(p.em_promocao, false);
  assert.equal(p.preco_de_centavos, null);
});

test("o link é do site de hoje, não do WordPress antigo", () => {
  const p = paraOPainel(produtoCru(), "https://persimateriais.com.br/");
  // O `permalink` do catálogo aponta para o domínio antigo. Mandá-lo ao
  // cliente é mandá-lo para uma loja que não é mais a loja.
  assert.equal(p.link, "https://persimateriais.com.br/cimento-cp-ii-50kg");
  assert.ok(!p.link.includes("wordpress"));
  // URL PLANA: a loja preservou o que o WordPress já tinha indexado. Um
  // "/produto/" inventado aqui mandaria o cliente para um 404.
  assert.ok(!p.link.includes("/produto/"));
});

test("promoção só quando o preço cheio é MAIOR que o cobrado", () => {
  const emOferta = paraOPainel(
    produtoCru({ price: 31.9, regularPrice: 38.9, onSale: true }),
    "https://persimateriais.com.br",
  );
  assert.equal(emOferta.em_promocao, true);
  assert.equal(emOferta.preco_centavos, 3190);
  assert.equal(emOferta.preco_de_centavos, 3890);

  // O catálogo já devolveu `onSale: true` com os dois preços IGUAIS. Seguir
  // o `onSale` faria o atendente mandar "de R$ 38,90 por R$ 38,90".
  const falsaOferta = paraOPainel(
    produtoCru({ price: 38.9, regularPrice: 38.9, onSale: true }),
    "https://persimateriais.com.br",
  );
  assert.equal(falsaOferta.em_promocao, false);
  assert.equal(falsaOferta.preco_de_centavos, null);
});

test("unidade ausente é null, e não um palpite", () => {
  const sem = paraOPainel(produtoCru(), "https://persimateriais.com.br");
  assert.equal(sem.unidade, null);

  const com = paraOPainel(
    produtoCru({
      attributes: [
        { id: 1, name: "Cor", taxonomy: null, hasVariations: false, terms: [{ id: 9, name: "Cinza", slug: "cinza" }] },
        { id: 2, name: "Unidade de venda", taxonomy: null, hasVariations: false, terms: [{ id: 3, name: "saco", slug: "saco" }] },
      ],
    }),
    "https://persimateriais.com.br",
  );
  assert.equal(com.unidade, "saco");
});

test("produto sem estoque sai marcado, e não some da lista", () => {
  // Sumir seria pior: o atendente procuraria, não acharia, e diria ao cliente
  // que a loja não trabalha com o produto.
  const p = paraOPainel(produtoCru({ available: false, stockStatus: "outofstock" }),
                        "https://persimateriais.com.br");
  assert.equal(p.disponivel, false);
  assert.equal(p.nome, "Cimento CP II 50kg");
});

test("nada do que sai guarda preço: é só o retrato de agora", () => {
  // O contrato não tem campo de validade nem de cache de propósito. Quem
  // guardar este objeto está guardando preço — e preço guardado é preço de
  // ontem dito com a confiança de hoje.
  const p = paraOPainel(produtoCru(), "https://persimateriais.com.br");
  const campos = Object.keys(p).sort();
  assert.deepEqual(campos, [
    "disponivel", "em_promocao", "id", "imagem", "link", "marca",
    "nome", "preco_centavos", "preco_de_centavos", "sku", "unidade",
  ]);
});

test("a comparação da chave não vaza pelo tempo", async () => {
  process.env.PAINEL_API_KEY = CHAVE;
  // As duas pontas viram hash do MESMO tamanho antes de comparar: é isso que
  // torna o tempo independente do conteúdo e do comprimento.
  const a = crypto.createHash("sha256").update(CHAVE).digest();
  const b = crypto.createHash("sha256").update("x").digest();
  assert.equal(a.length, b.length);

  // E conferido no FONTE, porque trocar `timingSafeEqual` por `===` não muda
  // resposta nenhuma: o defeito é invisível para qualquer teste de
  // comportamento, e some de vista na primeira "simplificação".
  const fonte = await readFile(
    new URL("../../lib/painel/chave.ts", import.meta.url), "utf8");
  assert.match(fonte, /timingSafeEqual/);
  assert.equal(/return String\(recebida\) ===/.test(fonte), false);
  assert.equal(/recebida === esperada/.test(fonte), false);
});

// ----------------------------------------------------------------- a rota
//
// `next/server` não resolve fora do Next, então a rota é conferida no FONTE,
// como as outras rotas deste repositório. O que importa aqui é a ORDEM e o que
// não existe — e as duas coisas são legíveis no texto.
test("a rota confere a chave ANTES de qualquer outra coisa", async () => {
  const fonte = await readFile(
    new URL("../../app/api/painel/produtos/route.ts", import.meta.url), "utf8");

  const ondeConfere = fonte.indexOf("chaveConfere");
  const ondeLimita = fonte.indexOf("isLimited");
  const ondeBusca = fonte.indexOf("searchWooCommerceProducts");
  assert.ok(ondeConfere > 0, "a rota confere a chave");
  // A forma EXATA da guarda, e não só a presença do nome: `if (false && ...)`
  // deixa a ordem bonita e a porta aberta.
  assert.match(fonte, /if \(!chaveConfere\(request\.headers\.get\("x-painel-key"\)\)\) \{/);
  // Limitar antes de autenticar deixa quem não tem chave gastar a cota de
  // quem tem; buscar antes de autenticar deixa qualquer um fazer o site
  // consultar o catálogo de graça, o dia inteiro.
  assert.ok(ondeConfere < ondeLimita, "a chave vem antes do limitador");
  assert.ok(ondeConfere < ondeBusca, "a chave vem antes da busca");
  assert.match(fonte, /401/);
});

test("a rota não guarda nem cacheia preço", async () => {
  const fonte = await readFile(
    new URL("../../app/api/painel/produtos/route.ts", import.meta.url), "utf8");
  // Preço com cache é preço de ontem dito com a confiança de hoje — e é
  // exatamente o motivo de esta rota existir.
  assert.match(fonte, /force-dynamic/);
  assert.match(fonte, /revalidate = 0/);
  assert.equal(/revalidate\s*=\s*[1-9]/.test(fonte), false);
});

test("a busca pública do site continua intocada", async () => {
  const fonte = await readFile(
    new URL("../../app/api/search/suggestions/route.ts", import.meta.url), "utf8");
  // A caixa de busca de quem está comprando não pode passar a exigir chave
  // nem a devolver preço promocional por um descuido nosso.
  assert.equal(fonte.includes("x-painel-key"), false);
  assert.equal(fonte.includes("chaveConfere"), false);
  assert.equal(fonte.includes("preco_centavos"), false);
});
