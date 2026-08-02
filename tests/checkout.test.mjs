import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatPostalCode,
  getFirstCheckoutErrorPath,
  resolveCheckoutViewState,
} from "../lib/commerce/checkout.ts";
import {
  checkoutDefaultValues,
  checkoutSchema,
} from "../lib/validation/checkout.ts";

const emptyCart = {
  items: [],
  itemsCount: 0,
  subtotal: 0,
  currencyCode: "BRL",
  currencySymbol: "R$",
  currencyMinorUnit: 2,
};

const cartWithProduct = {
  ...emptyCart,
  items: [{ key: "item-1" }],
  itemsCount: 1,
  subtotal: 10,
};

const validCheckout = {
  ...checkoutDefaultValues,
  contact: {
    email: "cliente@example.com",
    firstName: "Amanda",
    lastName: "Silva",
    company: "",
    phone: "(11) 99999-9999",
    document: "111.444.777-35",
  },
  billingAddress: {
    postalCode: "13201-000",
    addressLine1: "Rua Exemplo",
    number: "100",
    addressLine2: "",
    neighborhood: "Centro",
    city: "Jundiaí",
    state: "SP",
    country: "BR",
  },
  acceptsTerms: true,
};

test("checkout permanece em loading até a hidratação terminar", () => {
  assert.equal(
    resolveCheckoutViewState({
      cart: null,
      error: "",
      isHydrated: false,
      isLoading: true,
    }),
    "loading",
  );
});

test("checkout diferencia erro, carrinho vazio e carrinho com produto", () => {
  assert.equal(
    resolveCheckoutViewState({
      cart: null,
      error: "falha",
      isHydrated: true,
      isLoading: false,
    }),
    "error",
  );
  assert.equal(
    resolveCheckoutViewState({
      cart: emptyCart,
      error: "",
      isHydrated: true,
      isLoading: false,
    }),
    "empty",
  );
  assert.equal(
    resolveCheckoutViewState({
      cart: cartWithProduct,
      error: "",
      isHydrated: true,
      isLoading: false,
    }),
    "ready",
  );
});

test("valida e-mail e CEP com mensagens amigáveis", () => {
  const invalid = checkoutSchema.safeParse({
    ...validCheckout,
    contact: { ...validCheckout.contact, email: "invalido" },
    billingAddress: {
      ...validCheckout.billingAddress,
      postalCode: "123",
    },
  });

  assert.equal(invalid.success, false);
  if (invalid.success) return;
  assert.ok(invalid.error.issues.some(({ message }) => message.includes("e-mail")));
  assert.ok(invalid.error.issues.some(({ message }) => message.includes("CEP")));
  assert.equal(formatPostalCode("13201000"), "13201-000");
});

test("endereço de entrega igual não exige segundo endereço", () => {
  assert.equal(checkoutSchema.safeParse(validCheckout).success, true);
});

test("CPF inválido é rejeitado com mensagem amigável", () => {
  const invalid = checkoutSchema.safeParse({
    ...validCheckout,
    contact: { ...validCheckout.contact, document: "111.111.111-11" },
  });

  assert.equal(invalid.success, false);
  if (invalid.success) return;
  assert.ok(invalid.error.issues.some(({ message }) => message.includes("CPF")));
});

test("CNPJ válido também é aceito no campo de documento", () => {
  const valid = checkoutSchema.safeParse({
    ...validCheckout,
    contact: { ...validCheckout.contact, document: "11.222.333/0001-81" },
  });
  assert.equal(valid.success, true);
});

test("CNPJ inválido é rejeitado com a mesma mensagem amigável", () => {
  const invalid = checkoutSchema.safeParse({
    ...validCheckout,
    contact: { ...validCheckout.contact, document: "11.222.333/0001-82" },
  });

  assert.equal(invalid.success, false);
  if (invalid.success) return;
  assert.ok(invalid.error.issues.some(({ message }) => message.includes("CNPJ")));
});

test("endereço de entrega diferente é validado sem apagar seus valores", () => {
  const invalid = checkoutSchema.safeParse({
    ...validCheckout,
    shipToBillingAddress: false,
  });
  assert.equal(invalid.success, false);

  const valid = checkoutSchema.safeParse({
    ...validCheckout,
    shipToBillingAddress: false,
    shippingAddress: {
      ...validCheckout.billingAddress,
      addressLine1: "Rua da Entrega",
    },
  });
  assert.equal(valid.success, true);
});

test("termos não aceitos impedem avanço local", () => {
  const result = checkoutSchema.safeParse({
    ...validCheckout,
    acceptsTerms: false,
  });
  assert.equal(result.success, false);
});

test("primeiro erro segue a ordem visual e pode receber foco", () => {
  assert.equal(
    getFirstCheckoutErrorPath({
      billingAddress: { postalCode: { message: "CEP" } },
      contact: { email: { message: "E-mail" } },
    }),
    "contact.email",
  );
});

test("estrutura usa resumo oficial e breakpoints esperados", () => {
  const page = readFileSync("app/checkout/page.tsx", "utf8");
  const client = readFileSync(
    "components/Checkout/CheckoutPageClient.tsx",
    "utf8",
  );
  const summary = readFileSync(
    "components/Checkout/CheckoutOrderSummary.tsx",
    "utf8",
  );

  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /revalidate = 0/);
  assert.match(client, /lg:grid-cols/);
  assert.match(summary, /item\.total/);
  assert.match(summary, /cart\.totals\.items/);
  assert.match(summary, /cart\.totals\.price/);
});

test("checkout headless só fala com a rota própria de orquestração de pagamento, nunca com WooCommerce ou provedor direto", () => {
  const form = readFileSync("components/Checkout/CheckoutForm.tsx", "utf8");

  // Desde a Fase 6 do checkout headless (ver docs/25-checkout-gateway-audit.md,
  // decisão revertida conscientemente), o próprio front-end cria a cobrança
  // chamando `/api/checkout/payment` — o que este teste garante é que essa é
  // a ÚNICA superfície chamada, nunca a REST API do WooCommerce nem a API de
  // um provedor de pagamento diretamente do client.
  assert.match(form, /fetch\(\s*"\/api\/checkout\/payment"/);
  assert.doesNotMatch(form, /services\/woocommerce/);
  assert.doesNotMatch(form, /services\/payments\/(inter|pagbank)\/client/);
  assert.doesNotMatch(form, /cdpj\.partners\.bancointer|api\.pagseguro/);
});
