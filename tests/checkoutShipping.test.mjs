import assert from "node:assert/strict";
import test from "node:test";
import { mapCheckoutFormToWooAddress } from "../lib/commerce/checkoutAddress.ts";
import {
  CartServiceError,
  normalizeCart,
  normalizeShippingPackages,
  selectCartShippingRate,
  updateCartCustomer,
} from "../services/woocommerce/cart.ts";
import {
  formatStoreMoney,
  isZeroMoney,
} from "../lib/formatting/money.ts";

const moneyFields = {
  currency_code: "BRL",
  currency_symbol: "R$",
  currency_minor_unit: 2,
};

const rate = (overrides = {}) => ({
  rate_id: "flat_rate:3",
  name: "Frete Expresso",
  price: "1000",
  selected: false,
  method_id: "flat_rate",
  instance_id: 3,
  currency_code: "BRL",
  currency_symbol: "R$",
  currency_minor_unit: 2,
  meta_data: [],
  ...overrides,
});

const shippingPackage = (packageId, rates) => ({
  package_id: packageId,
  name: `Entrega ${Number(packageId) + 1}`,
  destination: {
    address_1: "Rua Teste, 10",
    address_2: "Centro",
    city: "Jundiaí",
    state: "SP",
    postcode: "13214065",
    country: "BR",
  },
  shipping_rates: rates,
});

test("normaliza um pacote e preserva IDs reais", () => {
  const packages = normalizeShippingPackages([
    shippingPackage(0, [rate()]),
  ]);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].packageId, 0);
  assert.equal(packages[0].rates[0].rateId, "flat_rate:3");
  assert.equal(packages[0].rates[0].methodId, "flat_rate");
});

test("normaliza múltiplos pacotes e seleção independente", () => {
  const packages = normalizeShippingPackages([
    shippingPackage(0, [rate({ selected: true })]),
    shippingPackage(1, [
      rate({ rate_id: "flat_rate:7", instance_id: 7 }),
    ]),
  ]);
  assert.equal(packages.length, 2);
  assert.equal(packages[0].rates[0].selected, true);
  assert.equal(packages[1].rates[0].selected, false);
});

test("aceita ausência de pacotes e taxas sem inventar opções", () => {
  assert.deepEqual(normalizeShippingPackages(undefined), []);
  assert.deepEqual(
    normalizeShippingPackages([shippingPackage(0, [])])[0].rates,
    [],
  );
});

test("preserva frete gratuito, pago e retirada local", () => {
  const packages = normalizeShippingPackages([
    shippingPackage(0, [
      rate({
        rate_id: "free_shipping:2",
        method_id: "free_shipping",
        price: "0",
      }),
      rate(),
      rate({
        rate_id: "local_pickup:4",
        method_id: "local_pickup",
        price: "0",
      }),
    ]),
  ]);
  const [free, paid, pickup] = packages[0].rates;
  assert.equal(isZeroMoney(free.price), true);
  assert.equal(formatStoreMoney(paid.price), "R$ 10,00");
  assert.equal(pickup.methodId, "local_pickup");
});

test("prazo só existe quando vem do campo ou metadata confiável", () => {
  const packages = normalizeShippingPackages([
    shippingPackage(0, [
      rate({ rate_id: "sem-prazo" }),
      rate({ rate_id: "direto", delivery_time: "2 dias úteis" }),
      rate({
        rate_id: "metadata",
        meta_data: [
          {
            key: "_wc_smart_checkout_delivery_time",
            value: "Até 3 dias úteis",
          },
        ],
      }),
    ]),
  ]);
  assert.equal(packages[0].rates[0].deliveryTime, undefined);
  assert.equal(packages[0].rates[1].deliveryTime, "2 dias úteis");
  assert.equal(packages[0].rates[2].deliveryTime, "Até 3 dias úteis");
});

test("mapper central cria cobrança e entrega iguais sem meta keys", () => {
  const form = {
    contact: {
      email: "cliente@example.com",
      firstName: "Cliente",
      lastName: "Teste",
      company: "",
      phone: "(11) 99999-9999",
    },
    billingAddress: {
      postalCode: "13214-065",
      addressLine1: "Rua Itirapina",
      number: "163",
      addressLine2: "Sala 1",
      neighborhood: "Vila Lacerda",
      city: "Jundiaí",
      state: "sp",
      country: "BR",
    },
    shipToBillingAddress: true,
    shippingAddress: {
      postalCode: "",
      addressLine1: "",
      number: "",
      addressLine2: "",
      neighborhood: "",
      city: "",
      state: "",
      country: "BR",
    },
    acceptsTerms: false,
  };
  const payload = mapCheckoutFormToWooAddress(form);
  assert.equal(payload.billingAddress.address1, "Rua Itirapina, 163");
  assert.equal(
    payload.billingAddress.address2,
    "Vila Lacerda - Sala 1",
  );
  assert.equal(payload.shippingAddress.address1, "Rua Itirapina, 163");
  assert.equal(payload.billingAddress.postcode, "13214065");
  assert.equal(payload.billingAddress.state, "SP");
  assert.equal("number" in payload.billingAddress, false);
  assert.equal("neighborhood" in payload.billingAddress, false);
});

test("mapper usa endereço de entrega diferente quando solicitado", () => {
  const base = {
    postalCode: "13214-065",
    addressLine1: "Rua A",
    number: "10",
    addressLine2: "",
    neighborhood: "Centro",
    city: "Jundiaí",
    state: "SP",
    country: "BR",
  };
  const payload = mapCheckoutFormToWooAddress({
    contact: {
      email: "cliente@example.com",
      firstName: "Cliente",
      lastName: "Teste",
      company: "Empresa",
      phone: "11999999999",
    },
    billingAddress: base,
    shipToBillingAddress: false,
    shippingAddress: { ...base, addressLine1: "Rua B", number: "20" },
    acceptsTerms: true,
  });
  assert.equal(payload.billingAddress.address1, "Rua A, 10");
  assert.equal(payload.shippingAddress.address1, "Rua B, 20");
  assert.equal(payload.shippingAddress.email, undefined);
});

test("normalizador usa exclusivamente totais oficiais do carrinho", () => {
  const cart = normalizeCart({
    items: [],
    items_count: 0,
    coupons: [
      {
        code: "TESTE",
        discount_type: "fixed_cart",
        totals: {
          ...moneyFields,
          total_discount: "100",
          total_discount_tax: "0",
        },
      },
    ],
    fees: [],
    totals: {
      ...moneyFields,
      total_items: "1000",
      total_items_tax: "0",
      total_fees: "0",
      total_fees_tax: "0",
      total_discount: "100",
      total_discount_tax: "0",
      total_shipping: "500",
      total_shipping_tax: "0",
      total_price: "1400",
      total_tax: "0",
      tax_lines: [],
    },
    needs_shipping: true,
    has_calculated_shipping: true,
    shipping_rates: [shippingPackage(0, [rate({ price: "500" })])],
  });
  assert.equal(cart.totals.items.value, "1000");
  assert.equal(cart.totals.discount.value, "100");
  assert.equal(cart.totals.shipping.value, "500");
  assert.equal(cart.totals.price.value, "1400");
  assert.equal(cart.shippingPackages.length, 1);
});

test("formatação monetária suporta valores grandes sem parseFloat", () => {
  assert.equal(
    formatStoreMoney({
      value: "12345678901234567890",
      currencyCode: "BRL",
      currencySymbol: "R$",
      currencyMinorUnit: 2,
    }),
    "R$ 123.456.789.012.345.678,90",
  );
});

test("seleção envia somente package_id e rate_id e preserva Cart-Token", async () => {
  const originalFetch = globalThis.fetch;
  const originalWordPressUrl = process.env.WORDPRESS_URL;
  let captured;
  process.env.WORDPRESS_URL = "https://example.test";
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(
      JSON.stringify({
        items: [],
        items_count: 0,
        totals: { ...moneyFields, total_price: "0" },
      }),
      { status: 200, headers: { "Cart-Token": "token-atualizado" } },
    );
  };
  try {
    const result = await selectCartShippingRate(
      { packageId: 0, rateId: "flat_rate:3" },
      "token-anterior",
    );
    assert.equal(result.cartToken, "token-atualizado");
    assert.match(captured.url, /cart\/select-shipping-rate$/);
    assert.equal(captured.options.headers["Cart-Token"], "token-anterior");
    assert.deepEqual(JSON.parse(captured.options.body), {
      package_id: 0,
      rate_id: "flat_rate:3",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WORDPRESS_URL = originalWordPressUrl;
  }
});

test("update-customer converte contrato interno para Store API", async () => {
  const originalFetch = globalThis.fetch;
  const originalWordPressUrl = process.env.WORDPRESS_URL;
  let body;
  process.env.WORDPRESS_URL = "https://example.test";
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        items: [],
        items_count: 0,
        totals: { ...moneyFields, total_price: "0" },
      }),
      { status: 200 },
    );
  };
  const address = {
    firstName: "Cliente",
    lastName: "Teste",
    address1: "Rua A, 10",
    address2: "Centro",
    city: "Jundiaí",
    state: "SP",
    postcode: "13214065",
    country: "BR",
  };
  try {
    await updateCartCustomer(
      {
        billingAddress: {
          ...address,
          email: "cliente@example.com",
          phone: "11999999999",
        },
        shippingAddress: address,
      },
      "token",
    );
    assert.equal(body.billing_address.address_1, "Rua A, 10");
    assert.equal(body.billing_address.email, "cliente@example.com");
    assert.equal(body.shipping_address.address_1, "Rua A, 10");
    assert.equal("number" in body.shipping_address, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WORDPRESS_URL = originalWordPressUrl;
  }
});

test("erros 400, 500 e timeout são tipados sem resposta bruta", async () => {
  const originalFetch = globalThis.fetch;
  const originalWordPressUrl = process.env.WORDPRESS_URL;
  process.env.WORDPRESS_URL = "https://example.test";
  try {
    for (const status of [400, 500]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ code: `erro-${status}`, message: "Detalhe interno" }),
          { status },
        );
      await assert.rejects(
        selectCartShippingRate(
          { packageId: 0, rateId: "flat_rate:3" },
          "token",
        ),
        (error) =>
          error instanceof CartServiceError &&
          error.status === status &&
          error.code === `erro-${status}`,
      );
    }
    globalThis.fetch = async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    };
    await assert.rejects(
      selectCartShippingRate(
        { packageId: 0, rateId: "flat_rate:3" },
        "token",
      ),
      (error) => error instanceof CartServiceError && error.status === 504,
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WORDPRESS_URL = originalWordPressUrl;
  }
});
