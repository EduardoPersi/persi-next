import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMelhorEnvioQuotes } from "../../lib/shipping/normalizers/melhorEnvio.ts";
import { buildQuoteCacheKey } from "../../lib/shipping/cache.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const TTL_MS = 15 * 60 * 1000;

test("cotação normal: prefere custom_price/custom_delivery_time e converte para minor units sem erro de float", () => {
  const raw = [
    {
      id: 3, name: "SEDEX", price: "29.90", custom_price: "27.90",
      delivery_time: 5, custom_delivery_time: 3,
      company: { id: 1, name: "Correios" },
    },
  ];

  const { quotes, warnings } = normalizeMelhorEnvioQuotes(raw, NOW, TTL_MS);

  assert.equal(warnings.length, 0);
  assert.equal(quotes.length, 1);
  const [quote] = quotes;
  assert.equal(quote.priceMinor, 2790);
  assert.equal(quote.originalPriceMinor, 2990);
  assert.equal(quote.estimatedDays, 3);
  assert.equal(quote.carrier, "Correios");
  assert.equal(quote.serviceCode, "3");
  assert.equal(quote.provider, "melhor_envio");
  assert.equal(new Date(quote.expiresAt).getTime(), NOW.getTime() + TTL_MS);
});

test("resposta com um único objeto (sem array) é normalizada do mesmo jeito — quirk documentado da API", () => {
  const raw = { id: 1, name: "PAC", price: "19.90", delivery_time: 8, company: { id: 1, name: "Correios" } };
  const { quotes } = normalizeMelhorEnvioQuotes(raw, NOW, TTL_MS);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].priceMinor, 1990);
});

test("sem nenhuma transportadora disponível para a rota: todas as entradas com 'error' viram warnings, quotes fica vazio", () => {
  const raw = [
    { id: 1, name: "PAC", error: "Área de entrega não coberta.", company: { id: 1, name: "Correios" } },
    { id: 2, name: "SEDEX", error: "Área de entrega não coberta.", company: { id: 1, name: "Correios" } },
  ];

  const { quotes, warnings } = normalizeMelhorEnvioQuotes(raw, NOW, TTL_MS);

  assert.equal(quotes.length, 0);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.code === "CARRIER_UNAVAILABLE"));
});

test("entrada incompleta (sem preço/prazo) é descartada com warning, sem derrubar as demais", () => {
  const raw = [
    { id: 1, name: "PAC", price: "19.90", delivery_time: 8, company: { id: 1, name: "Correios" } },
    { id: 2, name: "SEDEX", company: { id: 1, name: "Correios" } },
  ];

  const { quotes, warnings } = normalizeMelhorEnvioQuotes(raw, NOW, TTL_MS);

  assert.equal(quotes.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "CARRIER_UNAVAILABLE");
});

test("resposta vazia ou em formato inesperado nunca lança exceção, só retorna listas vazias", () => {
  assert.deepEqual(normalizeMelhorEnvioQuotes(null, NOW, TTL_MS), { quotes: [], warnings: [] });
  assert.deepEqual(normalizeMelhorEnvioQuotes(undefined, NOW, TTL_MS), { quotes: [], warnings: [] });
  assert.deepEqual(normalizeMelhorEnvioQuotes("erro cru de string", NOW, TTL_MS), { quotes: [], warnings: [] });
});

test("buildQuoteCacheKey é determinística e independente da ordem dos itens", () => {
  const keyA = buildQuoteCacheKey("melhor_envio", "13214065", [
    { variantId: "aaa", quantity: 1 },
    { variantId: "bbb", quantity: 2 },
  ]);
  const keyB = buildQuoteCacheKey("melhor_envio", "13214065", [
    { variantId: "bbb", quantity: 2 },
    { variantId: "aaa", quantity: 1 },
  ]);
  assert.equal(keyA, keyB);
});

test("buildQuoteCacheKey muda com CEP, item ou quantidade diferentes", () => {
  const base = buildQuoteCacheKey("melhor_envio", "13214065", [{ variantId: "aaa", quantity: 1 }]);
  const otherPostcode = buildQuoteCacheKey("melhor_envio", "01310000", [{ variantId: "aaa", quantity: 1 }]);
  const otherQuantity = buildQuoteCacheKey("melhor_envio", "13214065", [{ variantId: "aaa", quantity: 2 }]);
  const otherItem = buildQuoteCacheKey("melhor_envio", "13214065", [{ variantId: "ccc", quantity: 1 }]);

  assert.notEqual(base, otherPostcode);
  assert.notEqual(base, otherQuantity);
  assert.notEqual(base, otherItem);
});
