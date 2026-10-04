import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_DE_LINKS, normalizarConfigDeLinks, lerDominiosProprios } from "../lib/tracking/config.ts";
import { hrefInicial, linkRastreadoBase, montarHrefRastreado } from "../lib/tracking/whatsappLink.ts";

const WA = "https://wa.me/551139648294";
const CONFIG = normalizarConfigDeLinks(undefined, "site-padrao");

const origem = {
  ultimo_toque: {
    utm_source: "google", utm_medium: "cpc", utm_campaign: "forro", utm_content: "a", utm_term: "gesso forro",
    gclid: "GCL", gbraid: "GB", wbraid: "WB", fbclid: "FB",
    referrer: "https://www.google.com/", pagina_entrada: "https://persimateriais.com.br/", em: "2026-10-04T00:00:00Z",
  },
  ga_client_id: "1234567890.1700000000",
  fbp: "fb.1.1700000000000.1234567890",
  fbc: "fb.1.1700000000000.AbCdEf",
};

test("configuração: padrão do subdomínio, código inválido ou vazio desliga o rastreio", () => {
  assert.equal(normalizarConfigDeLinks(undefined, "").base, "https://zap.persimateriais.com.br");
  assert.equal(normalizarConfigDeLinks("https://x.com.br/", "abc").base, "https://x.com.br");
  assert.equal(normalizarConfigDeLinks("javascript:alert(1)", "abc").base, "https://zap.persimateriais.com.br");
  assert.equal(normalizarConfigDeLinks("lixo", "abc").base, "https://zap.persimateriais.com.br");
  assert.equal(normalizarConfigDeLinks(undefined, "../../x").codigo, "");
  assert.equal(normalizarConfigDeLinks(undefined, "  forro-google ").codigo, "forro-google");
  // sem a variável no ambiente de teste, o rastreio vem desligado
  assert.equal(CONFIG_DE_LINKS.codigo, "");
});

test("domínios próprios: padrão + extras válidos", () => {
  assert.deepEqual(lerDominiosProprios(undefined), ["persimateriais.com.br"]);
  assert.deepEqual(lerDominiosProprios("loja.exemplo.com, <x>"), ["persimateriais.com.br", "loja.exemplo.com"]);
});

test("SEM código: o link é o wa.me original, em qualquer situação (o botão nunca quebra)", () => {
  const semCodigo = normalizarConfigDeLinks(undefined, undefined);
  assert.equal(hrefInicial(semCodigo, WA), WA);
  assert.equal(montarHrefRastreado(semCodigo, WA, { origem, consentiu: true }), WA);
  assert.equal(linkRastreadoBase(semCodigo), null);
});

test("HTML do servidor: link rastreado já sem parâmetros (funciona sem JavaScript)", () => {
  assert.equal(hrefInicial(CONFIG, WA), "https://zap.persimateriais.com.br/w/site-padrao");
});

test("COM consentimento: leva utm, ids de clique, ga, fbp, fbc, pg, ref e sid", () => {
  const href = montarHrefRastreado(CONFIG, WA, {
    origem, pagina: "https://persimateriais.com.br/forro", sid: "SID123", consentiu: true,
  });
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://zap.persimateriais.com.br/w/site-padrao");
  const p = Object.fromEntries(url.searchParams);
  assert.deepEqual(p, {
    utm_source: "google", utm_medium: "cpc", utm_campaign: "forro", utm_content: "a", utm_term: "gesso forro",
    gclid: "GCL", gbraid: "GB", wbraid: "WB", fbclid: "FB",
    ga: "1234567890.1700000000", fbp: "fb.1.1700000000000.1234567890", fbc: "fb.1.1700000000000.AbCdEf",
    pg: "https://persimateriais.com.br/forro", ref: "https://www.google.com/", sid: "SID123",
  });
});

test("SEM consentimento: só UTMs, página, ref e sid — nada de anúncio nem fbp/fbc/ga", () => {
  const href = montarHrefRastreado(CONFIG, WA, { origem, pagina: "https://persimateriais.com.br/", sid: "S", consentiu: false });
  const p = Object.fromEntries(new URL(href).searchParams);
  for (const proibido of ["gclid", "gbraid", "wbraid", "fbclid", "ga", "fbp", "fbc"]) {
    assert.equal(p[proibido], undefined, `${proibido} não pode ir sem consentimento`);
  }
  assert.equal(p.utm_source, "google");
  assert.equal(p.sid, "S");
});

test("sem nada para mandar, é o link base; valores gigantes são cortados no teto", () => {
  assert.equal(montarHrefRastreado(CONFIG, WA, { consentiu: false }), "https://zap.persimateriais.com.br/w/site-padrao");
  const href = montarHrefRastreado(CONFIG, WA, {
    origem: { ultimo_toque: { utm_source: "a".repeat(900), gclid: "g".repeat(900), em: "2026-10-04T00:00:00Z" } },
    pagina: "p".repeat(3000), consentiu: true,
  });
  const p = Object.fromEntries(new URL(href).searchParams);
  assert.equal(p.utm_source.length, 300);
  assert.equal(p.gclid.length, 512);
  assert.equal(p.pg.length, 1000);
});

test("caracteres especiais são codificados (e não quebram a URL)", () => {
  const href = montarHrefRastreado(CONFIG, WA, {
    origem: { ultimo_toque: { utm_campaign: "forro & drywall=ok?#", em: "2026-10-04T00:00:00Z" } }, consentiu: false,
  });
  assert.equal(new URL(href).searchParams.get("utm_campaign"), "forro & drywall=ok?#");
  assert.ok(!href.includes("#"));
});
