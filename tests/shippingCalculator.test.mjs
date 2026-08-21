import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EMPTY_SHIPPING_CACHE_TTL_MS,
  formatPostcode,
  getCartShippingContextKey,
  getProductShippingContextKey,
  isValidPostcode,
  readShippingCache,
  SHIPPING_CACHE_TTL_MS,
  shouldStartAutomaticShippingRequest,
  writeShippingCache,
} from "../lib/commerce/shippingCalculator.ts";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("CEP aceita oito dígitos e aplica hífen automaticamente", () => {
  assert.equal(formatPostcode("13214065"), "13214-065");
  assert.equal(formatPostcode("13214-065"), "13214-065");
  assert.equal(isValidPostcode("13214-065"), true);
  assert.equal(isValidPostcode("1321"), false);
});

test("troca de CEP não reaproveita chave de requisição anterior", () => {
  assert.notEqual(formatPostcode("13214065"), formatPostcode("13201000"));
});

test("cache preserva opções e método por trinta minutos", () => {
  const storage = createStorage();
  const timestamp = 1_000_000;
  const entry = {
    contextKey: "cart:1:2",
    postcode: "13214065",
    quote: {
      packages: [{
        packageId: 0,
        rates: [{
          packageId: 0,
          rateId: "local_pickup:1",
          name: "Retirada",
          price: {
            value: "0",
            currencyCode: "BRL",
            currencySymbol: "R$",
            currencyMinorUnit: 2,
          },
          selected: true,
        }],
      }],
    },
    selected: {
      packageId: 0,
      postcode: "13214065",
      rateId: "local_pickup:1",
    },
    timestamp,
  };
  writeShippingCache(storage, entry);

  assert.deepEqual(
    readShippingCache(storage, entry.contextKey, timestamp + 1_000),
    entry,
  );
  assert.equal(
    readShippingCache(
      storage,
      entry.contextKey,
      timestamp + SHIPPING_CACHE_TTL_MS + 1,
    ),
    null,
  );
});

test("cache preserva resultado sem frete por cinco minutos", () => {
  const storage = createStorage();
  const timestamp = 2_000_000;
  const entry = {
    contextKey: "product:105955:0:1",
    postcode: "11703250",
    quote: { packages: [] },
    timestamp,
  };
  writeShippingCache(storage, entry);

  assert.deepEqual(
    readShippingCache(
      storage,
      entry.contextKey,
      timestamp + EMPTY_SHIPPING_CACHE_TTL_MS,
    ),
    entry,
  );
  assert.equal(
    readShippingCache(
      storage,
      entry.contextKey,
      timestamp + EMPTY_SHIPPING_CACHE_TTL_MS + 1,
    ),
    null,
  );
});

test("resultado empty conclui o disparo automático sem loop", () => {
  const hook = readFileSync(
    new URL("../hooks/useShippingCalculator.ts", import.meta.url),
    "utf8",
  );

  assert.match(hook, /type ShippingStatus = "idle" \| "loading" \| "success" \| "empty" \| "error"/);
  assert.match(hook, /lastCompletedKey\.current = requestKey/);
  assert.match(hook, /calculate\(digits, \{ force: false \}\)/);
  assert.match(hook, /shouldStartAutomaticShippingRequest/);
  assert.doesNotMatch(hook, /quote\.packages,\s*\n\s*setSelection/);
  assert.match(hook, /activeRequest\.current\?\.abort\(\)/);
  assert.match(hook, /Não encontramos opções de entrega para este CEP\./);
});

test("gate automático bloqueia requisição ativa e qualquer resultado concluído", () => {
  const key = "product:105955:0:1:11703250";
  assert.equal(shouldStartAutomaticShippingRequest(key, key, ""), false);
  assert.equal(shouldStartAutomaticShippingRequest(key, "", key), false);
  assert.equal(shouldStartAutomaticShippingRequest(key, "", ""), true);
  assert.equal(
    shouldStartAutomaticShippingRequest(
      "product:105955:0:1:13214065",
      "",
      key,
    ),
    true,
  );
});

test("alterar quantidade muda o contexto e força nova cotação", () => {
  const baseCart = {
    items: [{ id: 10, quantity: 1 }],
  };
  assert.notEqual(
    getCartShippingContextKey(baseCart),
    getCartShippingContextKey({
      items: [{ id: 10, quantity: 2 }],
    }),
  );
});

test("produto simples e variação possuem contextos independentes", () => {
  assert.equal(
    getProductShippingContextKey({
      productId: 10,
      quantity: 1,
    }),
    "product:10:0:1",
  );
  assert.equal(
    getProductShippingContextKey({
      productId: 10,
      variationId: 11,
      quantity: 1,
    }),
    "product:10:11:1",
  );
});

test("produto e carrinho compartilham o mesmo componente sem cálculo local", () => {
  const product = readFileSync(
    "components/Product/ProductPurchasePanel.tsx",
    "utf8",
  );
  const cart = readFileSync("components/Cart/CartPage.tsx", "utf8");
  const component = readFileSync(
    "components/Shipping/ShippingCalculator.tsx",
    "utf8",
  );
  const productRoute = readFileSync(
    "app/api/shipping/product/route.ts",
    "utf8",
  );

  assert.match(product, /<ShippingCalculator/);
  assert.match(cart, /<ShippingCalculator/);
  assert.match(productRoute, /getCart\(\)/);
  assert.match(productRoute, /addItemToCart/);
  assert.match(productRoute, /updateCartShippingPostcode/);
  assert.doesNotMatch(component, /shipping\s*\+|price\s*\+|total\s*=/i);
});

test("calculadora usa somente o endereço de CEP verificado no servidor", () => {
  const component = readFileSync(
    new URL(
      "../components/Shipping/ShippingCalculator.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const hook = readFileSync(
    new URL("../hooks/useShippingCalculator.ts", import.meta.url),
    "utf8",
  );
  const postcodeService = readFileSync(
    new URL("../services/shipping/postcode.ts", import.meta.url),
    "utf8",
  );

  assert.match(component, /destination\?\.address1/);
  assert.match(component, /destination\?\.city/);
  assert.match(hook, /result\.cart\.shippingDestination/);
  assert.doesNotMatch(hook, /destination: result\.cart\.shippingAddress/);
  assert.match(postcodeService, /https:\/\/viacep\.com\.br\/ws\//);
  assert.match(postcodeService, /body\.erro === true/);
});

test("prazo numérico recebe dia útil no singular ou plural", () => {
  const optionCard = readFileSync(
    new URL(
      "../components/Shipping/ShippingOptionCard.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(optionCard, /days === 1 \? "dia útil" : "dias úteis"/);
  assert.match(optionCard, /formatDeliveryTime\(rate\.deliveryTime\)/);
});
