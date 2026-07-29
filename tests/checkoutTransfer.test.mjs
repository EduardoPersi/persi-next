import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalCheckoutTransferRequest,
  buildCheckoutTransferPayload,
  CheckoutTransferError,
  createCheckoutTransfer,
  getCheckoutTransferConfig,
  parseCheckoutTransferResponse,
  signCheckoutTransferRequest,
} from "../lib/commerce/checkoutTransfer.ts";
import {
  CheckoutTransferRequestGate,
  requestCheckoutTransfer,
} from "../lib/commerce/checkoutTransferClient.ts";
import { getAuthoritativeCheckoutItems } from "../services/checkout/headlessCheckout.ts";

const token = "A".repeat(43);
const transferUrl =
  `https://persimateriais.com.br/checkout/?persi_checkout_transfer=${token}`;
const config = {
  endpoint:
    "https://persimateriais.com.br/wp-json/persi-headless/v1/checkout-transfer",
  keyId: "primary",
  origin: "https://app.persimateriais.com.br",
  secret: "test-only-secret",
};

const simplePayload = buildCheckoutTransferPayload([
  { productId: 123, variationId: 0, quantity: 2 },
]);
const variationPayload = buildCheckoutTransferPayload([
  { productId: 123, variationId: 456, quantity: 1 },
]);

test("assinatura é determinística para corpo, timestamp e nonce iguais", () => {
  const options = {
    timestamp: "1720000000",
    nonce: "AbCdEfGhIjKlMnOpQrStUv",
  };
  const first = signCheckoutTransferRequest(simplePayload, config, options);
  const second = signCheckoutTransferRequest(simplePayload, config, options);

  assert.equal(first.rawBody, second.rawBody);
  assert.equal(first.canonicalRequest, second.canonicalRequest);
  assert.equal(
    first.headers["X-Persi-Signature"],
    second.headers["X-Persi-Signature"],
  );
  assert.equal(
    first.canonicalRequest,
    buildCanonicalCheckoutTransferRequest({
      rawBody: first.rawBody,
      timestamp: options.timestamp,
      nonce: options.nonce,
      origin: config.origin,
    }),
  );
  assert.equal(first.canonicalRequest.endsWith("\n"), false);
});

test("corpo adulterado produz outra assinatura", () => {
  const options = {
    timestamp: "1720000000",
    nonce: "AbCdEfGhIjKlMnOpQrStUv",
  };
  const original = signCheckoutTransferRequest(simplePayload, config, options);
  const tampered = signCheckoutTransferRequest(
    buildCheckoutTransferPayload([
      { productId: 123, variationId: 0, quantity: 3 },
    ]),
    config,
    options,
  );

  assert.notEqual(
    original.headers["X-Persi-Signature"],
    tampered.headers["X-Persi-Signature"],
  );
});

test("configuração rejeita segredo ou endpoint ausente", () => {
  assert.throws(
    () =>
      getCheckoutTransferConfig({
        PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID: "primary",
        PERSI_HEADLESS_CHECKOUT_ORIGIN: config.origin,
        PERSI_HEADLESS_CHECKOUT_ENDPOINT: config.endpoint,
      }),
    CheckoutTransferError,
  );
  assert.throws(
    () =>
      getCheckoutTransferConfig({
        PERSI_HEADLESS_CHECKOUT_HMAC_SECRET: "secret",
        PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID: "primary",
        PERSI_HEADLESS_CHECKOUT_ORIGIN: config.origin,
      }),
    CheckoutTransferError,
  );
});

test("carrinho vazio é rejeitado e payloads simples/variáveis são mínimos", () => {
  assert.throws(() => buildCheckoutTransferPayload([]), CheckoutTransferError);
  assert.deepEqual(simplePayload, {
    items: [{ productId: 123, variationId: 0, quantity: 2 }],
    couponCodes: [],
    shippingMethod: { rateId: "", packageIndex: 0 },
  });
  assert.deepEqual(variationPayload.items, [
    { productId: 123, variationId: 456, quantity: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(simplePayload), /price|total|stock|tax/i);
});

test("leitura autoritativa resolve produto simples e pai da variação", async () => {
  const cart = {
    items: [
      { id: 123, quantity: 2 },
      { id: 456, quantity: 1 },
    ],
  };
  const resolver = async (itemId) =>
    itemId === 123
      ? { productId: 123, variationId: 0 }
      : { productId: 321, variationId: 456 };

  assert.deepEqual(
    await getAuthoritativeCheckoutItems(cart, resolver),
    [
      { productId: 123, variationId: 0, quantity: 2 },
      { productId: 321, variationId: 456, quantity: 1 },
    ],
  );
});

test("gate impede clique duplicado até finalizar", () => {
  const gate = new CheckoutTransferRequestGate();
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.equal(gate.tryStart(), true);
});

test("resposta exige transferUrl HTTPS no domínio esperado", () => {
  assert.throws(
    () => parseCheckoutTransferResponse({ expiresAt: new Date().toISOString() }),
    CheckoutTransferError,
  );
  assert.throws(
    () =>
      parseCheckoutTransferResponse({
        transferUrl:
          `https://unexpected.example/checkout/?persi_checkout_transfer=${token}`,
        expiresAt: new Date().toISOString(),
      }),
    CheckoutTransferError,
  );
  assert.equal(
    parseCheckoutTransferResponse({
      transferUrl,
      expiresAt: new Date().toISOString(),
    }).transferUrl,
    transferUrl,
  );
});

for (const status of [401, 409, 422, 503]) {
  test(`erro ${status} do WordPress é preservado sem detalhes internos`, async () => {
    const fetchMock = async () =>
      new Response(JSON.stringify({ code: "internal", secret: "hidden" }), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    await assert.rejects(
      createCheckoutTransfer(simplePayload, config, fetchMock),
      (error) =>
        error instanceof CheckoutTransferError && error.status === status,
    );
  });
}

test("diagnóstico diferencia 401 do WordPress sem expor resposta remota", async () => {
  await assert.rejects(
    createCheckoutTransfer(
      simplePayload,
      config,
      async () =>
        new Response(JSON.stringify({ code: "authentication_failed" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ),
    (error) =>
      error instanceof CheckoutTransferError &&
      error.status === 401 &&
      error.diagnosticCode === "CHECKOUT_WORDPRESS_401" &&
      !error.message.includes("authentication_failed"),
  );
});

test("cliente rejeita resposta sem URL e não depende de payload do carrinho", async () => {
  let request;
  const fetchMock = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(requestCheckoutTransfer(fetchMock));
  assert.equal(request.url, "/api/checkout-transfer");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, undefined);
});
