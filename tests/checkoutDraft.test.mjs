import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_DRAFT_TTL_MS,
  buildCheckoutDraft,
  getCheckoutStepAccess,
  mergeCheckoutDraft,
  parseCheckoutDraft,
  parseCheckoutStep,
  resolveInitialCheckoutStep,
  serializeCheckoutDraft,
} from "../lib/commerce/checkoutDraft.ts";
import { checkoutDefaultValues } from "../lib/validation/checkout.ts";

const NOW = 1_800_000_000_000;

const address = {
  postalCode: "13201-000",
  addressLine1: "Rua Rangel Pestana",
  number: "100",
  addressLine2: "",
  neighborhood: "Centro",
  city: "Jundiaí",
  state: "SP",
  country: "BR",
  recipientName: "Maria Souza",
};

function filledValues(overrides = {}) {
  return {
    ...checkoutDefaultValues,
    contact: {
      email: "maria@example.com",
      firstName: "Maria",
      lastName: "Souza",
      company: "",
      phone: "(11) 98765-4321",
      personType: "fisica",
      document: "529.982.247-25",
    },
    billingAddress: { ...address },
    acceptsTerms: true,
    ...overrides,
  };
}

test("o rascunho guarda só os campos permitidos e nunca dados sensíveis", () => {
  const values = {
    ...filledValues(),
    password: "segredo",
    otp: "123456",
    paymentMethod: "mercadopago_card",
    cardNumber: "4111111111111111",
    cvv: "123",
    cardToken: "tok_x",
  };
  const raw = serializeCheckoutDraft(values, NOW);
  assert.ok(raw);
  for (const forbidden of [
    "segredo",
    "123456",
    "mercadopago_card",
    "4111111111111111",
    "tok_x",
    "maria@example.com",
    "acceptsTerms",
    "password",
    "paymentMethod",
    "cvv",
  ]) {
    assert.equal(raw.includes(forbidden), false, `vazou: ${forbidden}`);
  }
  assert.deepEqual(Object.keys(buildCheckoutDraft(values)).sort(), [
    "billingAddress",
    "contact",
    "includeOrderNote",
    "orderNote",
    "shipToBillingAddress",
    "shippingAddress",
  ]);
});

test("formulário em branco não gera rascunho", () => {
  assert.equal(serializeCheckoutDraft(checkoutDefaultValues, NOW), null);
});

test("lê o que gravou e devolve os mesmos dados", () => {
  const raw = serializeCheckoutDraft(filledValues(), NOW);
  const draft = parseCheckoutDraft(raw, NOW + 1000);
  assert.equal(draft?.contact.firstName, "Maria");
  assert.equal(draft?.contact.phone, "(11) 98765-4321");
  assert.equal(draft?.billingAddress.addressLine1, "Rua Rangel Pestana");
});

test("rascunho expira em 3 dias e rejeita lixo, versão antiga e data futura", () => {
  const raw = serializeCheckoutDraft(filledValues(), NOW);
  assert.ok(parseCheckoutDraft(raw, NOW + CHECKOUT_DRAFT_TTL_MS));
  assert.equal(parseCheckoutDraft(raw, NOW + CHECKOUT_DRAFT_TTL_MS + 1), null);
  assert.equal(parseCheckoutDraft(raw, NOW - 10 * 60_000), null);
  assert.equal(parseCheckoutDraft("{não é json", NOW), null);
  assert.equal(parseCheckoutDraft("null", NOW), null);
  assert.equal(parseCheckoutDraft(null, NOW), null);
  assert.equal(
    parseCheckoutDraft(JSON.stringify({ v: 0, savedAt: NOW, values: {} }), NOW),
    null,
  );
});

test("campos com tipo errado viram vazio e textos longos são cortados", () => {
  const raw = JSON.stringify({
    v: 1,
    savedAt: NOW,
    values: {
      contact: { firstName: 42, lastName: "x".repeat(900) },
      billingAddress: "texto",
      orderNote: "Entregar na portaria",
    },
  });
  const draft = parseCheckoutDraft(raw, NOW);
  assert.equal(draft?.contact.firstName, "");
  assert.equal(draft?.contact.lastName.length, 500);
  assert.equal(draft?.billingAddress.postalCode, "");
  assert.equal(draft?.orderNote, "Entregar na portaria");
});

test("mescla só preenche campos vazios e nunca mexe no e-mail", () => {
  const draft = parseCheckoutDraft(serializeCheckoutDraft(filledValues(), NOW), NOW);
  const current = {
    ...checkoutDefaultValues,
    contact: {
      ...checkoutDefaultValues.contact,
      email: "conta@example.com",
      firstName: "Ana",
    },
  };
  const merged = mergeCheckoutDraft(current, draft);
  assert.equal(merged.contact.firstName, "Ana");
  assert.equal(merged.contact.lastName, "Souza");
  assert.equal(merged.contact.email, "conta@example.com");
  assert.equal(merged.billingAddress.city, "Jundiaí");
  assert.equal(merged.acceptsTerms, false);
});

test("CPF/CNPJ e tipo PF/PJ nunca entram no rascunho nem voltam dele", () => {
  const juridica = filledValues({
    contact: { ...filledValues().contact, personType: "juridica", document: "11.222.333/0001-81" },
  });
  const raw = serializeCheckoutDraft(juridica, NOW);
  assert.ok(raw);
  for (const forbidden of ["11.222.333", "11222333", "529.982", "document", "personType"]) {
    assert.ok(!raw.includes(forbidden), `vazou: ${forbidden}`);
  }

  // Mesmo um rascunho antigo, gravado com documento, é lido sem ele.
  const legacy = JSON.stringify({
    v: 1,
    savedAt: NOW,
    values: { contact: { firstName: "Ana", document: "529.982.247-25", personType: "juridica" } },
  });
  const draft = parseCheckoutDraft(legacy, NOW);
  assert.equal(draft?.contact.firstName, "Ana");
  assert.equal("document" in draft.contact, false);

  const merged = mergeCheckoutDraft(
    {
      ...checkoutDefaultValues,
      contact: { ...checkoutDefaultValues.contact, document: "529.982.247-25", personType: "fisica" },
    },
    draft,
  );
  assert.equal(merged.contact.document, "529.982.247-25");
  assert.equal(merged.contact.personType, "fisica");
});

test("endereço de entrega diferente e observação são restaurados", () => {
  const values = filledValues({
    shipToBillingAddress: false,
    shippingAddress: { ...address, number: "200" },
    includeOrderNote: true,
    orderNote: "Ligar antes",
  });
  const draft = parseCheckoutDraft(serializeCheckoutDraft(values, NOW), NOW);
  const merged = mergeCheckoutDraft(checkoutDefaultValues, draft);
  assert.equal(merged.shipToBillingAddress, false);
  assert.equal(merged.shippingAddress.number, "200");
  assert.equal(merged.includeOrderNote, true);
  assert.equal(merged.orderNote, "Ligar antes");
});

test("parseCheckoutStep só aceita as três etapas", () => {
  assert.equal(parseCheckoutStep("address"), "address");
  assert.equal(parseCheckoutStep("payment"), "payment");
  assert.equal(parseCheckoutStep("profile"), "profile");
  assert.equal(parseCheckoutStep("admin"), null);
  assert.equal(parseCheckoutStep(null), null);
});

test("acesso às etapas valida em silêncio e ignora o aceite de termos", () => {
  assert.deepEqual(getCheckoutStepAccess(filledValues({ acceptsTerms: false })), {
    profileValid: true,
    addressValid: true,
  });
  assert.deepEqual(getCheckoutStepAccess(checkoutDefaultValues), {
    profileValid: false,
    addressValid: false,
  });
  const noAddress = filledValues({ billingAddress: { ...address, addressLine1: "" } });
  assert.deepEqual(getCheckoutStepAccess(noAddress), {
    profileValid: true,
    addressValid: false,
  });
});

test("etapa inicial nunca pula etapa sem dados válidos", () => {
  const ok = { profileValid: true, addressValid: true };
  const resolve = (input) =>
    resolveInitialCheckoutStep({ requested: null, isLoggedIn: false, addressReady: true, access: ok, ...input });

  assert.equal(resolve({}), "profile");
  assert.equal(resolve({ requested: "payment" }), "payment");
  assert.equal(resolve({ requested: "payment", addressReady: false }), "address");
  assert.equal(
    resolve({ requested: "payment", access: { profileValid: true, addressValid: false } }),
    "address",
  );
  assert.equal(
    resolve({ requested: "payment", access: { profileValid: false, addressValid: false } }),
    "profile",
  );
  assert.equal(resolve({ requested: "profile" }), "profile");
});

test("cliente logado com perfil válido abre em Entrega; visitante não", () => {
  const ok = { profileValid: true, addressValid: false };
  assert.equal(
    resolveInitialCheckoutStep({ requested: null, isLoggedIn: true, access: ok, addressReady: false }),
    "address",
  );
  assert.equal(
    resolveInitialCheckoutStep({ requested: null, isLoggedIn: false, access: ok, addressReady: false }),
    "profile",
  );
  assert.equal(
    resolveInitialCheckoutStep({
      requested: null,
      isLoggedIn: true,
      access: { profileValid: false, addressValid: false },
      addressReady: false,
    }),
    "profile",
  );
});
