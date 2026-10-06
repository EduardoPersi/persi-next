// Teste ponta a ponta do rastreio (Sprint 3B), num navegador de verdade.
//
// O que prova:
//  1. HTML do servidor: o link de WhatsApp já é o rastreado, sem parâmetros.
//  2. Visita com ?utm_source=google&utm_medium=cpc&gclid=abc, SEM consentimento:
//     cookies só de sessão, sem gclid; o clique chega ao painel com as UTMs e
//     SEM gclid.
//  3. COM consentimento (clicando em "Concordo"): cookies de 90 dias com o
//     gclid; o clique chega ao painel com o gclid.
//  4. Visita direta depois NÃO troca o último toque.
//  5. O dataLayer recebe `clique_whatsapp` e um único `page_view` por rota.
//
// Como rodar (precisa de uma build com o link configurado, ver LEIA-ME 3B):
//   1) node <persi-atendimento>/testes/fakes/painel-rastreio.mjs 3399
//   2) NEXT_PUBLIC_WHATSAPP_LINK_CODIGO=forro-google \
//      NEXT_PUBLIC_LINKS_BASE_URL=http://127.0.0.1:3399 npm run build
//      npx next start -p 3100
//   3) npm run test:rastreio:e2e
// Variáveis: SITE_URL (padrão http://127.0.0.1:3100), PAINEL_URL_FAKE
// (padrão http://127.0.0.1:3399). Se o Chromium que o Playwright do projeto
// espera não estiver instalado, aponte outro: PLAYWRIGHT_MODULE (caminho do
// index.mjs de outro Playwright) e/ou PLAYWRIGHT_CHROMIUM_PATH (executável).

import assert from "node:assert/strict";

const SITE = process.env.SITE_URL || "http://127.0.0.1:3100";
const PAINEL = process.env.PAINEL_URL_FAKE || "http://127.0.0.1:3399";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const LP = "/contato?utm_source=google&utm_medium=cpc&utm_campaign=forro&gclid=abc";
const resultados = [];
async function passo(nome, fn) {
  try {
    await fn();
    resultados.push([nome, true]);
    console.log(`ok   - ${nome}`);
  } catch (erro) {
    resultados.push([nome, false]);
    console.error(`FAIL - ${nome}\n       ${erro.message}`);
  }
}

const estado = async () => (await fetch(`${PAINEL}/__estado`)).json();
const zerar = () => fetch(`${PAINEL}/__zerar`, { method: "POST" });

const navegador = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);

async function novoContexto() {
  const contexto = await navegador.newContext();
  // Sem rede externa: o painel de mentira redireciona para o wa.me.
  await contexto.route("https://wa.me/**", (rota) => rota.fulfill({ status: 200, body: "wa.me" }));
  return contexto;
}

/** Clica no link de WhatsApp do rodapé e espera o clique chegar ao painel. */
async function clicarNoRodape(pagina) {
  const link = pagina.locator("footer a[aria-label='Conversar com a Persi Materiais pelo WhatsApp']").first();
  await link.scrollIntoViewIfNeeded();
  const [popup] = await Promise.all([pagina.context().waitForEvent("page"), link.click()]);
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  await popup.close();
}

const cookiesDeRastreio = async (contexto) =>
  (await contexto.cookies(SITE)).filter((c) => c.name.startsWith("persi_") && c.name !== "persi_cookie_consent");

await passo("HTML do servidor já traz o link rastreado, sem parâmetros e sem JavaScript", async () => {
  const html = await (await fetch(`${SITE}/contato`)).text();
  assert.ok(html.includes(`href="${PAINEL}/w/forro-google"`), "href inicial não é o link rastreado");
  assert.ok(!html.includes("wa.me/551139648294\""), "ainda há wa.me cru no HTML do /contato");
});

await passo("SEM consentimento: cookies só de sessão, nenhum gclid, e o clique leva UTMs sem gclid", async () => {
  await zerar();
  const contexto = await novoContexto();
  const pagina = await contexto.newPage();
  await pagina.goto(`${SITE}${LP}`);
  await pagina.waitForFunction(() => document.cookie.includes("persi_lt="));

  const cookies = await cookiesDeRastreio(contexto);
  assert.deepEqual(cookies.map((c) => c.name).sort(), ["persi_ft", "persi_lt", "persi_sid"]);
  for (const c of cookies) {
    assert.equal(c.expires, -1, `${c.name} deveria ser cookie de sessão`);
    assert.equal(c.sameSite, "Lax");
    assert.ok(!decodeURIComponent(c.value).includes("abc"), `${c.name} vazou o gclid`);
  }
  const todos = (await contexto.cookies(SITE)).map((c) => c.name);
  for (const proibido of ["_fbp", "_fbc", "_gcl_aw", "_gcl_au"]) assert.ok(!todos.includes(proibido));

  await clicarNoRodape(pagina);
  const { cliques } = await estado();
  assert.equal(cliques.length, 1);
  const p = cliques[0].params;
  assert.equal(cliques[0].codigo, "forro-google");
  assert.equal(p.utm_source, "google");
  assert.equal(p.utm_medium, "cpc");
  assert.equal(p.utm_campaign, "forro");
  assert.equal(p.gclid, undefined, "gclid não pode ir sem consentimento");
  assert.match(p.pg, /\/contato$/);
  assert.ok(p.sid && p.sid.length >= 8);

  const dl = await pagina.evaluate(() => window.dataLayer.filter((e) => e && e.event).map((e) => e.event));
  assert.ok(dl.includes("clique_whatsapp"), "faltou clique_whatsapp no dataLayer");
  await contexto.close();
});

await passo("COM consentimento: cookies de 90 dias com gclid, e o clique leva o gclid", async () => {
  await zerar();
  const contexto = await novoContexto();
  const pagina = await contexto.newPage();
  await pagina.goto(`${SITE}${LP}`);
  await pagina.getByRole("button", { name: "Concordo" }).click();
  await pagina.waitForFunction(() => /persi_lt=[^;]*gclid/.test(document.cookie) || /persi_lt=[^;]*abc/.test(document.cookie));

  const cookies = await cookiesDeRastreio(contexto);
  const agora = Date.now() / 1000;
  for (const nome of ["persi_ft", "persi_lt"]) {
    const c = cookies.find((x) => x.name === nome);
    assert.ok(c, `${nome} ausente`);
    const dias = (c.expires - agora) / 86400;
    assert.ok(dias > 89 && dias < 91, `${nome} deveria durar ~90 dias, durou ${dias.toFixed(1)}`);
    assert.ok(decodeURIComponent(c.value).includes('"gclid":"abc"'), `${nome} sem gclid`);
  }
  assert.equal(cookies.find((c) => c.name === "persi_sid").expires, -1);

  await clicarNoRodape(pagina);
  const { cliques } = await estado();
  assert.equal(cliques.length, 1);
  assert.equal(cliques[0].params.gclid, "abc");
  assert.equal(cliques[0].params.utm_source, "google");

  // Visita direta depois: não pode apagar a campanha (último toque).
  await pagina.goto(`${SITE}/contato`);
  await pagina.waitForTimeout(500);
  const lt = (await cookiesDeRastreio(contexto)).find((c) => c.name === "persi_lt");
  assert.ok(decodeURIComponent(lt.value).includes('"utm_source":"google"'), "visita direta trocou o último toque");
  await contexto.close();
});

await passo("botão flutuante também passa pelo link rastreado", async () => {
  await zerar();
  const contexto = await novoContexto();
  const pagina = await contexto.newPage();
  await pagina.goto(`${SITE}/contato?utm_source=meta&utm_medium=social`);
  await pagina.getByRole("button", { name: "Falar com a Persi Materiais pelo WhatsApp" }).click();
  const link = pagina.getByRole("link", { name: "Falar no WhatsApp" });
  const [popup] = await Promise.all([contexto.waitForEvent("page"), link.click()]);
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  const { cliques } = await estado();
  assert.equal(cliques.length, 1);
  assert.equal(cliques[0].params.utm_source, "meta");
  await contexto.close();
});

await passo("dataLayer: um único page_view por rota (sem duplicar) e eventos novos no lugar", async () => {
  const contexto = await novoContexto();
  const pagina = await contexto.newPage();
  await pagina.goto(`${SITE}/contato`);
  await pagina.waitForTimeout(800);
  await pagina.locator("a[href='/']").first().click();
  await pagina.waitForURL(`${SITE}/`);
  await pagina.waitForTimeout(800);
  const views = await pagina.evaluate(() => window.dataLayer.filter((e) => e && e.event === "page_view").map((e) => e.page_path));
  assert.deepEqual(views, ["/contato", "/"]);
  await contexto.close();
});

await navegador.close();
const falhas = resultados.filter(([, ok]) => !ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} passos ok`);
process.exit(falhas ? 1 : 0);
