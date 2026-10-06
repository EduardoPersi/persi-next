import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  montarBeginCheckout,
  montarItem,
  montarPurchase,
  registrarBeginCheckout,
  registrarCliqueWhatsapp,
  registrarGerarLead,
  registrarPurchase,
} from "../lib/analytics/eventos.ts";
import { lerIdsDeAnalytics } from "../lib/analytics/config.ts";

beforeEach(() => {
  globalThis.window = { dataLayer: [] };
});

test("clique_whatsapp: nome do evento e chaves documentadas no guia do GTM, sem dado pessoal", () => {
  registrarCliqueWhatsapp({ posicao: "rodape", linkRastreado: true, codigo: "site-padrao", pagina: "/contato" });
  assert.deepEqual(window.dataLayer, [
    { event: "clique_whatsapp", whatsapp_posicao: "rodape", whatsapp_link_rastreado: true, whatsapp_link_codigo: "site-padrao", page_path: "/contato" },
  ]);
});

test("clique_whatsapp sem rastreio configurado: evento sai igual, sem código", () => {
  registrarCliqueWhatsapp({ posicao: "rodape", linkRastreado: false, pagina: "/" });
  assert.equal(window.dataLayer[0].whatsapp_link_rastreado, false);
  assert.equal("whatsapp_link_codigo" in window.dataLayer[0], false);
});

test("gerar_lead não leva nome, e-mail, telefone nem mensagem", () => {
  registrarGerarLead({ formulario: "contato", pagina: "/contato" });
  assert.deepEqual(window.dataLayer, [{ event: "gerar_lead", form_name: "contato", lead_tipo: "formulario", page_path: "/contato" }]);
});

test("item usa SKU e, sem SKU, o id do produto (igual a add_to_cart/view_item)", () => {
  assert.equal(montarItem({ sku: "ABC-1", productId: 9, name: "Placa", price: 10, quantity: 2 }).item_id, "ABC-1");
  assert.equal(montarItem({ sku: "", productId: 9, name: "Placa", price: 10, quantity: 2 }).item_id, "9");
  assert.equal(montarItem({ productId: 9, name: "P", quantity: 0 }).quantity, 1);
  assert.equal("price" in montarItem({ productId: 9, name: "P", quantity: 1 }), false);
});

test("begin_checkout: limpa o ecommerce anterior e manda BRL, value e items", () => {
  registrarBeginCheckout(montarBeginCheckout({ value: 199.9, items: [montarItem({ sku: "A", name: "X", price: 99.95, quantity: 2 })] }));
  assert.deepEqual(window.dataLayer[0], { ecommerce: null });
  assert.deepEqual(window.dataLayer[1], {
    event: "begin_checkout",
    ecommerce: { currency: "BRL", value: 199.9, items: [{ item_id: "A", item_name: "X", price: 99.95, quantity: 2 }] },
  });
});

test("purchase: transaction_id texto, value numérico, currency BRL, items", () => {
  const e = montarPurchase({ transactionId: 30911, value: "259.90", shipping: "20.00", items: [montarItem({ productId: 5, name: "Y", price: "119.95", quantity: 2 })] });
  assert.equal(e.transaction_id, "30911");
  assert.equal(e.value, 259.9);
  assert.equal(e.currency, "BRL");
  assert.equal(e.shipping, 20);
  registrarPurchase(e);
  assert.equal(window.dataLayer[1].event, "purchase");
  assert.equal(window.dataLayer[1].ecommerce.transaction_id, "30911");
});

test("purchase com valor inválido não inventa receita (vira 0, não NaN)", () => {
  assert.equal(montarPurchase({ transactionId: 1, value: "abc", items: [] }).value, 0);
});

test("IDs de GA4 e Pixel: só passam no formato certo; vazio não injeta nada", () => {
  assert.deepEqual(lerIdsDeAnalytics(undefined, undefined), {});
  assert.deepEqual(lerIdsDeAnalytics("", "  "), {});
  assert.deepEqual(lerIdsDeAnalytics("G-ABC123XYZ9", "123456789012345"), { ga4_measurement_id: "G-ABC123XYZ9", meta_pixel_id: "123456789012345" });
  assert.deepEqual(lerIdsDeAnalytics("'; alert(1); //", "<script>"), {}, "valor fora do formato nunca vira script");
});

// --- O page_view da troca de rota que o site JÁ tinha continua intacto ------

test("o page_view de troca de rota continua no layout, uma única vez, e não foi alterado pelos eventos novos", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.equal(layout.match(/<AnalyticsPageView \/>/g).length, 1);
  const tracker = await readFile(new URL("../components/layout/AnalyticsPageView.tsx", import.meta.url), "utf8");
  assert.match(tracker, /event: "page_view"/);
  assert.match(tracker, /lastTracked\.current === pagePath/, "a trava contra duplicar page_view segue lá");
  // Os eventos novos não podem ter outro "page_view" escondido.
  for (const arquivo of ["../lib/analytics/eventos.ts", "../components/Tracking/OrigemCapture.tsx", "../components/UI/LinkWhatsApp.tsx"]) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    assert.doesNotMatch(fonte, /["']page_view["']/, `${arquivo} não deve disparar page_view`);
  }
});

test("os eventos convivem com page_view no mesmo dataLayer, cada um uma vez, em ordem", () => {
  window.dataLayer.push({ event: "page_view", page_path: "/forro" });
  registrarCliqueWhatsapp({ posicao: "rodape", linkRastreado: true, codigo: "c", pagina: "/forro" });
  window.dataLayer.push({ event: "page_view", page_path: "/contato" });
  registrarGerarLead({ formulario: "contato", pagina: "/contato" });
  const eventos = window.dataLayer.map((e) => e.event);
  assert.deepEqual(eventos, ["page_view", "clique_whatsapp", "page_view", "gerar_lead"]);
});

test("consentimento: o update vai para a fila do dataLayer como 'arguments' (não se perde antes de o GTM carregar)", async () => {
  const { updateGoogleConsent } = await import("../lib/analytics/consentMode.ts");
  assert.equal(window.gtag, undefined, "simula o GTM ainda não carregado");
  updateGoogleConsent("accepted");
  const comando = Array.from(window.dataLayer[0]);
  assert.deepEqual(comando[0], "consent");
  assert.deepEqual(comando[1], "update");
  assert.deepEqual(comando[2], { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" });
  assert.equal(Array.isArray(window.dataLayer[0]), false, "precisa ser o objeto arguments, não um array");
  updateGoogleConsent("declined");
  assert.equal(Array.from(window.dataLayer[1])[2].ad_storage, "denied");
});
