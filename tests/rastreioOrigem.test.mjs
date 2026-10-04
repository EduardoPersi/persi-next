import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JANELA_DO_COOKIE_SEGUNDOS,
  decidirToques,
  descreverVisita,
  extrairClientIdDoGa,
  lerParametrosDeCampanha,
  lerToque,
  planejarCookies,
  referrerEhExterno,
  serializarToque,
  validarFbc,
  validarFbp,
} from "../lib/tracking/origem.ts";

const PROPRIOS = ["persimateriais.com.br"];
const AGORA = new Date("2026-10-04T12:00:00.000Z");

function visita(extra = {}) {
  return descreverVisita({
    search: "",
    paginaDeEntrada: "https://persimateriais.com.br/",
    referrer: "",
    dominiosProprios: PROPRIOS,
    novaSessao: true,
    agora: AGORA,
    ...extra,
  });
}

test("lê UTMs e ids de clique, ignora o resto e limpa lixo", () => {
  const p = lerParametrosDeCampanha(
    "?utm_source=google&utm_medium=cpc&utm_campaign=forro%20gesso&gclid=abc123&fbclid=XYZ&outro=1&utm_term=%00%01  ",
  );
  assert.deepEqual(p, {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "forro gesso",
    gclid: "abc123",
    fbclid: "XYZ",
  });
});

test("corta valores acima do teto do contrato (300 padrão, 512 ids de clique)", () => {
  const p = lerParametrosDeCampanha(`?utm_source=${"a".repeat(900)}&gclid=${"b".repeat(900)}`);
  assert.equal(p.utm_source.length, 300);
  assert.equal(p.gclid.length, 512);
});

test("referrer: externo só quando aponta para fora do site (subdomínios são do site)", () => {
  assert.equal(referrerEhExterno("https://www.google.com/", PROPRIOS), true);
  assert.equal(referrerEhExterno("https://persimateriais.com.br/x", PROPRIOS), false);
  assert.equal(referrerEhExterno("https://www.persimateriais.com.br/x", PROPRIOS), false);
  assert.equal(referrerEhExterno("https://zap.persimateriais.com.br/w/a", PROPRIOS), false);
  assert.equal(referrerEhExterno("https://persimateriais.com.br.evil.com/", PROPRIOS), true);
  assert.equal(referrerEhExterno("", PROPRIOS), false);
  assert.equal(referrerEhExterno("isso nao e url", PROPRIOS), false);
});

test("visita com parâmetro de campanha é 'campanha' e leva a página sem a query", () => {
  const v = visita({ search: "?utm_source=google&gclid=abc", paginaDeEntrada: "https://persimateriais.com.br/forro" });
  assert.equal(v.tipo, "campanha");
  assert.equal(v.toque.gclid, "abc");
  assert.equal(v.toque.pagina_entrada, "https://persimateriais.com.br/forro");
  assert.equal(v.toque.em, AGORA.toISOString());
});

test("referrer externo em sessão nova é 'referrer'; em sessão antiga é 'direto'", () => {
  assert.equal(visita({ referrer: "https://www.google.com/" }).tipo, "referrer");
  assert.equal(visita({ referrer: "https://www.google.com/", novaSessao: false }).tipo, "direto");
  assert.equal(visita({ referrer: "https://persimateriais.com.br/a" }).tipo, "direto");
});

test("primeiro toque nasce uma vez; visita direta NÃO troca o último toque", () => {
  const campanha = visita({ search: "?utm_source=google&utm_medium=cpc" });
  let t = decidirToques({}, campanha);
  assert.equal(t.primeiro.utm_source, "google");
  assert.equal(t.ultimo.utm_source, "google");

  const direta = visita({ agora: new Date("2026-10-05T12:00:00Z"), novaSessao: true });
  t = decidirToques(t, direta);
  assert.equal(t.ultimo.utm_source, "google", "o direto não pode apagar a campanha");

  const outra = visita({ search: "?utm_source=meta&utm_medium=social", agora: new Date("2026-10-06T12:00:00Z") });
  t = decidirToques(t, outra);
  assert.equal(t.primeiro.utm_source, "google", "primeiro toque não muda");
  assert.equal(t.ultimo.utm_source, "meta");
});

test("referrer externo troca o último toque; direto sem toque nenhum semeia os dois", () => {
  const base = decidirToques({}, visita({ search: "?utm_source=google" }));
  const org = visita({ referrer: "https://www.bing.com/", agora: new Date("2026-10-07T00:00:00Z") });
  const t = decidirToques(base, org);
  assert.equal(t.ultimo.referrer, "https://www.bing.com/");
  const semente = decidirToques({}, visita());
  assert.ok(semente.primeiro && semente.ultimo);
});

test("COM consentimento: cookies persistentes de 90 dias com os ids de clique", () => {
  const toques = decidirToques({}, visita({ search: "?utm_source=google&gclid=abc" }));
  const cookies = planejarCookies("accepted", toques, "SID1");
  const por = Object.fromEntries(cookies.map((c) => [c.nome, c]));
  assert.equal(por.persi_sid.maxAgeSegundos, undefined, "sid é cookie de sessão");
  assert.equal(por.persi_ft.maxAgeSegundos, JANELA_DO_COOKIE_SEGUNDOS);
  assert.equal(JANELA_DO_COOKIE_SEGUNDOS, 90 * 24 * 3600);
  assert.equal(por.persi_lt.maxAgeSegundos, JANELA_DO_COOKIE_SEGUNDOS);
  assert.equal(lerToque(por.persi_lt.valor).gclid, "abc");
});

for (const consentimento of ["declined", null]) {
  test(`SEM consentimento (${consentimento}): só sessão, só UTM, nenhum id de clique`, () => {
    const toques = decidirToques(
      {},
      visita({ search: "?utm_source=google&utm_medium=cpc&gclid=abc&gbraid=g&wbraid=w&fbclid=f" }),
    );
    const cookies = planejarCookies(consentimento, toques, "SID1");
    for (const c of cookies) {
      assert.equal(c.maxAgeSegundos, undefined, `${c.nome} não pode ser persistente`);
      for (const proibido of ["gclid", "gbraid", "wbraid", "fbclid", "abc"]) {
        assert.ok(!decodeURIComponent(c.valor).includes(proibido), `${c.nome} vazou ${proibido}`);
      }
    }
    const lt = lerToque(cookies.find((c) => c.nome === "persi_lt").valor);
    assert.equal(lt.utm_source, "google");
    assert.equal(lt.utm_medium, "cpc");
  });
}

test("aceitar no meio da visita completa o toque da MESMA visita com o gclid", () => {
  const v = visita({ search: "?utm_source=google&gclid=abc" });
  // 1) antes do aceite: gravado sem gclid
  const antes = planejarCookies("declined", decidirToques({}, v), "S");
  const guardados = {
    primeiro: lerToque(antes.find((c) => c.nome === "persi_ft").valor),
    ultimo: lerToque(antes.find((c) => c.nome === "persi_lt").valor),
  };
  assert.equal(guardados.ultimo.gclid, undefined);
  // 2) depois do aceite, a mesma visita (em memória) é reaplicada
  const depois = decidirToques(guardados, v);
  assert.equal(depois.primeiro.gclid, "abc");
  assert.equal(depois.ultimo.gclid, "abc");
  const cookies = planejarCookies("accepted", depois, "S");
  assert.equal(cookies.find((c) => c.nome === "persi_ft").maxAgeSegundos, JANELA_DO_COOKIE_SEGUNDOS);
});

test("recusar depois de ter aceitado rebaixa tudo para sessão e tira os ids", () => {
  const completo = decidirToques({}, visita({ search: "?utm_source=google&gclid=abc" }));
  const cookies = planejarCookies("declined", completo, "S");
  assert.ok(cookies.every((c) => c.maxAgeSegundos === undefined));
  assert.equal(lerToque(cookies.find((c) => c.nome === "persi_lt").valor).gclid, undefined);
});

test("cookie adulterado é descartado ou saneado", () => {
  assert.equal(lerToque("%7Bnao-json"), undefined);
  assert.equal(lerToque(encodeURIComponent("[1,2]")), undefined);
  assert.equal(lerToque(encodeURIComponent(JSON.stringify({ utm_source: "x" }))), undefined, "sem 'em' não vale");
  const t = lerToque(
    encodeURIComponent(JSON.stringify({ em: "2026-10-04T00:00:00Z", utm_source: "ok", intruso: "x", utm_medium: 5, gclid: "y".repeat(2000) })),
  );
  assert.equal(t.utm_source, "ok");
  assert.equal(t.intruso, undefined);
  assert.equal(t.utm_medium, undefined);
  assert.equal(t.gclid.length, 512);
});

test("serializar e ler devolve o mesmo toque; cabe folgado num cookie", () => {
  const toque = { utm_source: "google", utm_campaign: "forro gesso & drywall", gclid: "a".repeat(512), pagina_entrada: "https://persimateriais.com.br/x", em: AGORA.toISOString() };
  const texto = serializarToque(toque);
  assert.deepEqual(lerToque(texto), toque);
  assert.ok(texto.length < 2000);
});

test("client_id do GA, fbp e fbc: só formatos válidos", () => {
  assert.equal(extrairClientIdDoGa("GA1.1.1234567890.1700000000"), "1234567890.1700000000");
  assert.equal(extrairClientIdDoGa("GA1.2.123.456"), undefined);
  assert.equal(extrairClientIdDoGa("lixo"), undefined);
  assert.equal(validarFbp("fb.1.1700000000000.1234567890"), "fb.1.1700000000000.1234567890");
  assert.equal(validarFbp("<script>"), undefined);
  assert.equal(validarFbc("fb.1.1700000000000.AbCdEf123_-"), "fb.1.1700000000000.AbCdEf123_-");
  assert.equal(validarFbc("x"), undefined);
});
