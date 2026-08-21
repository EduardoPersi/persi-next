import assert from "node:assert/strict";
import test from "node:test";
import {
  canAdvanceCheckoutAddress,
  isAddressComplete,
} from "../lib/commerce/checkout.ts";
import {
  hasSelectedShippingRate,
  isCheckoutCustomerSynced,
} from "../lib/commerce/checkoutAddress.ts";

const form = {
  contact: {
    email: "cliente@example.com",
    firstName: "Eduardo",
    lastName: "Pereira",
    company: "",
    phone: "(11) 99999-9999",
    personType: "fisica",
    document: "529.982.247-25",
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
    recipientName: "Eduardo Pereira",
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
    recipientName: "",
  },
  includeOrderNote: false,
  orderNote: "",
  acceptsTerms: false,
};

const billingAddress = {
  firstName: "Eduardo",
  lastName: "Pereira",
  address1: "Rua Exemplo, 100",
  address2: "Centro",
  city: "Jundiaí",
  state: "SP",
  postcode: "13201000",
  country: "BR",
  email: "cliente@example.com",
  phone: "11999999999",
};

const shippingAddress = {
  firstName: "Eduardo",
  lastName: "Pereira",
  address1: "Rua Exemplo, 100",
  address2: "Centro",
  city: "Jundiaí",
  state: "SP",
  postcode: "13201000",
  country: "BR",
};

const selectedPackages = [{
  packageId: 0,
  rates: [{ rateId: "flat_rate:1", name: "Frete Econômico", selected: true }],
}];

function canAdvance(overrides = {}) {
  return canAdvanceCheckoutAddress({
    needsShipping: true,
    addressComplete: isAddressComplete(form.billingAddress),
    hasSelectedShippingRate: hasSelectedShippingRate(selectedPackages),
    isUpdating: false,
    ...overrides,
  });
}

test("endereço preexistente sincronizado e Frete Econômico selecionado habilitam avanço", () => {
  assert.equal(canAdvance(), true);
});

test("Rua Conceição com Expresso selecionado habilita sem depender de customerSynced", () => {
  const reproducedAddress = {
    ...form.billingAddress,
    postalCode: "13216-140",
    addressLine1: "Rua Conceição",
    number: "426",
    city: "Jundiaí",
    state: "SP",
    recipientName: "Eduardo Pereira",
    addressLine2: "",
  };
  const packages = [{
    packageId: 0,
    rates: [
      { rateId: "local_pickup:1", name: "Retirada no local", selected: false },
      { rateId: "flat_rate:2", name: "Frete Expresso", selected: true },
    ],
  }];

  assert.equal(isAddressComplete(reproducedAddress), true);
  assert.equal(hasSelectedShippingRate(packages), true);
  assert.equal(
    canAdvanceCheckoutAddress({
      needsShipping: true,
      addressComplete: true,
      hasSelectedShippingRate: true,
      isUpdating: false,
    }),
    true,
  );
});

test("sem rate ou com rate antigo não selecionado o avanço permanece bloqueado", () => {
  assert.equal(canAdvance({ hasSelectedShippingRate: false }), false);
  assert.equal(hasSelectedShippingRate([{ packageId: 0, rates: [] }]), false);
  assert.equal(
    hasSelectedShippingRate([{
      packageId: 0,
      rates: [{ rateId: "obsolete", name: "Antigo", selected: false }],
    }]),
    false,
  );
});

test("CEP alterado bloqueia durante sincronização e libera após resposta atualizada", () => {
  const changedForm = {
    ...form,
    billingAddress: { ...form.billingAddress, postalCode: "13202-000" },
  };
  assert.equal(
    isCheckoutCustomerSynced(changedForm, billingAddress, shippingAddress),
    false,
  );
  assert.equal(canAdvance({ isUpdating: true }), false);
  assert.equal(canAdvance(), true);
});

test("complemento vazio não bloqueia e request em andamento sempre bloqueia", () => {
  assert.equal(form.billingAddress.addressLine2, "");
  assert.equal(isAddressComplete(form.billingAddress), true);
  assert.equal(canAdvance({ isUpdating: true }), false);
});

test("número ou destinatário vazio bloqueiam endereço", () => {
  assert.equal(
    isAddressComplete({ ...form.billingAddress, number: "" }),
    false,
  );
  assert.equal(
    isAddressComplete({ ...form.billingAddress, recipientName: "" }),
    false,
  );
});

test("retirada selecionada também é rate válido", () => {
  assert.equal(
    hasSelectedShippingRate([{
      packageId: 0,
      rates: [{
        rateId: "local_pickup:1",
        name: "Retirada no local",
        selected: true,
      }],
    }]),
    true,
  );
  assert.equal(canAdvance(), true);
});

test("carrinho sem necessidade de entrega não exige rate", () => {
  assert.equal(
    canAdvanceCheckoutAddress({
      needsShipping: false,
      addressComplete: false,
      hasSelectedShippingRate: false,
      isUpdating: false,
    }),
    true,
  );
});
