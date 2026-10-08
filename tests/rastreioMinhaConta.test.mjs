import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

const pagina = read("app/(institutional)/minha-conta/pedidos/[id]/page.tsx");

test("Minha conta só busca o rastreio depois de confirmar que o pedido é do cliente", () => {
  const confirmou = pagina.indexOf("getAccountOrder(token");
  const buscou = pagina.indexOf("await buscarRastreios(order.id)");
  assert.ok(confirmou > 0 && buscou > confirmou);
});

test("falha ao buscar o rastreio esconde a seção e não derruba a página", () => {
  const funcao = pagina.slice(pagina.indexOf("async function buscarRastreios"), pagina.indexOf("export default"));
  assert.match(funcao, /try \{/);
  assert.match(funcao, /catch \{\s*return \[\];/);
});

test("o link de rastreio abre em outra aba sem vazar a origem e usa o utilitário", () => {
  assert.match(pagina, /href=\{urlDoRastreio\(codigo\)\}/);
  assert.match(pagina, /target="_blank" rel="noopener noreferrer"/);
  assert.match(pagina, /rastreios\.length > 0 &&/);
});

test("o modelo do pedido guarda a LISTA de rastreios (metaData só guarda texto)", () => {
  const servico = read("services/woocommerce/orders.ts");
  assert.match(servico, /rastreios\?: string\[\]/);
  assert.match(servico, /rastreios: rastreiosDoPedido\(response\.meta_data\)/);
});
