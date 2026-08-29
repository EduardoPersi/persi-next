import assert from "node:assert/strict";
import test from "node:test";
import { applyAccountPrefill } from "../lib/commerce/checkoutAccountPrefill.ts";
import { checkoutDefaultValues } from "../lib/validation/checkout.ts";

const profile = {
  firstName: "Eduardo",
  lastName: "Pereira",
  displayName: "Eduardo Pereira",
  email: "compras@persimateriais.com.br",
  phone: "11964460218",
  birthDate: "",
  cpf: "11144477735",
};

function makeAddress(overrides = {}) {
  return {
    id: "billing",
    type: "billing",
    label: "Cobrança",
    firstName: "Eduardo",
    lastName: "Pereira",
    company: "",
    address1: "Rua Coronel Leme da Fonseca, 426",
    neighborhood: "Centro",
    address2: "Apto 12",
    city: "Jundiaí",
    state: "sp",
    postcode: "13201031",
    country: "BR",
    phone: "11964460218",
    isPrimary: true,
    ...overrides,
  };
}

test("preenche contato a partir do perfil, sem sobrescrever com campos vazios", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, { profile, addresses: [] });
  assert.equal(result.contact.firstName, "Eduardo");
  assert.equal(result.contact.lastName, "Pereira");
  assert.equal(result.contact.email, "compras@persimateriais.com.br");
  assert.equal(result.contact.phone, "(11) 96446-0218");
  assert.equal(result.contact.personType, "fisica");
  assert.equal(result.contact.document, "111.444.777-35");
});

test("sugere o destinatário a partir do nome do perfil", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, { profile, addresses: [] });
  assert.equal(result.billingAddress.recipientName, "Eduardo Pereira");
});

test("sem perfil, destinatário permanece vazio (preenchido depois pela etapa de perfil)", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, { profile: null, addresses: [] });
  assert.equal(result.billingAddress.recipientName, "");
});

test("perfil nulo ou vazio mantém os defaults do checkout intactos", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, { profile: null, addresses: [] });
  assert.deepEqual(result.contact, checkoutDefaultValues.contact);
});

test("endereço de cobrança da conta preenche billingAddress; número e complemento ficam em branco", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, {
    profile: null,
    addresses: [makeAddress()],
  });

  assert.equal(result.billingAddress.addressLine1, "Rua Coronel Leme da Fonseca, 426");
  assert.equal(result.billingAddress.number, "");
  assert.equal(result.billingAddress.addressLine2, "Apto 12");
  assert.equal(result.billingAddress.neighborhood, "Centro");
  assert.equal(result.billingAddress.city, "Jundiaí");
  assert.equal(result.billingAddress.state, "SP");
  assert.equal(result.billingAddress.postalCode, "13201-031");
  assert.equal(result.shipToBillingAddress, true);
});

test("a loja usa um único endereço: mesmo com endereço de entrega diferente salvo na conta, só o de cobrança é usado", () => {
  const shipping = makeAddress({
    id: "shipping",
    type: "shipping",
    address1: "Avenida Nove de Julho, 900",
    postcode: "13202000",
  });
  const result = applyAccountPrefill(checkoutDefaultValues, {
    profile: null,
    addresses: [makeAddress(), shipping],
  });

  assert.equal(result.shipToBillingAddress, true);
  assert.equal(result.billingAddress.addressLine1, "Rua Coronel Leme da Fonseca, 426");
  assert.deepEqual(result.shippingAddress, checkoutDefaultValues.shippingAddress);
});

test("sem endereço de cobrança, usa o de entrega como ponto de partida", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, {
    profile: null,
    addresses: [makeAddress({ id: "shipping", type: "shipping" })],
  });
  assert.equal(result.billingAddress.addressLine1, "Rua Coronel Leme da Fonseca, 426");
  assert.equal(result.shipToBillingAddress, true);
});

test("endereço sem address1 (conta sem cadastro ainda) não sobrescreve os defaults", () => {
  const result = applyAccountPrefill(checkoutDefaultValues, {
    profile: null,
    addresses: [makeAddress({ address1: "" }), makeAddress({ id: "shipping", type: "shipping", address1: "" })],
  });
  assert.deepEqual(result.billingAddress, checkoutDefaultValues.billingAddress);
});
