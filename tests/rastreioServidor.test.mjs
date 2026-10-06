import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lerOrigemDoPedido,
  lerOrigemDosCookies,
  origemDoPedidoDosCookies,
  serializarOrigemDoPedido,
} from "../lib/tracking/servidor.ts";
import { serializarToque } from "../lib/tracking/origem.ts";

const toque = {
  utm_source: "google", utm_medium: "cpc", gclid: "GCL", fbclid: "FB",
  pagina_entrada: "https://persimateriais.com.br/", em: "2026-10-04T00:00:00.000Z",
};

function leitor(cookies) {
  return (nome) => cookies[nome];
}

const COOKIES = {
  persi_ft: serializarToque(toque),
  persi_lt: serializarToque(toque),
  _ga: "GA1.1.1234567890.1700000000",
  _fbp: "fb.1.1700000000000.1234567890",
  _fbc: "fb.1.1700000000000.AbCdEf",
};

test("com consentimento aceito: lê toques completos, GA client_id, fbp e fbc", () => {
  const o = lerOrigemDosCookies(leitor({ ...COOKIES, persi_cookie_consent: "accepted" }));
  assert.equal(o.primeiro_toque.gclid, "GCL");
  assert.equal(o.ultimo_toque.fbclid, "FB");
  assert.equal(o.ga_client_id, "1234567890.1700000000");
  assert.equal(o.fbp, "fb.1.1700000000000.1234567890");
  assert.equal(o.fbc, "fb.1.1700000000000.AbCdEf");
});

for (const consentimento of ["declined", undefined, "qualquer-coisa"]) {
  test(`sem consentimento (${consentimento}): o servidor descarta ids de clique, fbp, fbc e ga — mesmo com o cookie presente`, () => {
    const o = lerOrigemDosCookies(leitor({ ...COOKIES, persi_cookie_consent: consentimento }));
    assert.equal(o.ultimo_toque.utm_source, "google", "a UTM da visita continua");
    assert.equal(o.ultimo_toque.gclid, undefined);
    assert.equal(o.primeiro_toque.fbclid, undefined);
    assert.equal(o.ga_client_id, undefined);
    assert.equal(o.fbp, undefined);
    assert.equal(o.fbc, undefined);
  });
}

test("sem cookie nenhum não há origem (o painel grava direto/desconhecido)", () => {
  assert.equal(lerOrigemDosCookies(leitor({})), undefined);
  assert.equal(origemDoPedidoDosCookies({ get: () => undefined }), undefined);
});

test("cookies forjados não passam", () => {
  const o = lerOrigemDosCookies(leitor({ persi_cookie_consent: "accepted", persi_ft: "{lixo", persi_lt: "x", _fbp: "<img>", _ga: "GA1.1.a.b" }));
  assert.equal(o, undefined);
});

test("pedido: serializa para o meta e lê de volta revalidando", () => {
  const origem = lerOrigemDosCookies(leitor({ ...COOKIES, persi_cookie_consent: "accepted" }));
  const texto = serializarOrigemDoPedido(origem);
  assert.deepEqual(lerOrigemDoPedido(texto), origem);
  assert.equal(lerOrigemDoPedido("não é json"), undefined);
  assert.equal(lerOrigemDoPedido(""), undefined);
  assert.equal(lerOrigemDoPedido(JSON.stringify({ ultimo_toque: { utm_source: "x" } })), undefined, "toque sem 'em' é inválido");
  const grande = { ultimo_toque: { ...toque, utm_source: "a".repeat(300) }, primeiro_toque: toque };
  assert.ok(serializarOrigemDoPedido(grande).length < 6000);
});

test("origemDoPedidoDosCookies nunca lança", () => {
  const explode = { get: () => { throw new Error("boom"); } };
  assert.equal(origemDoPedidoDosCookies(explode), undefined);
});
