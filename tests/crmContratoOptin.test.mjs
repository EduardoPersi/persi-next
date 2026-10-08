import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkoutDefaultValues, checkoutSchema } from "../lib/validation/checkout.ts";

const read = (path) => readFileSync(path, "utf8");

test("o schema aceita marcado e desmarcado, e o padrão do formulário é marcado", () => {
  assert.equal(checkoutDefaultValues.whatsappOptIn, true);
  const base = {
    ...checkoutDefaultValues,
    contact: {
      ...checkoutDefaultValues.contact,
      email: "maria@example.com",
      firstName: "Maria",
      lastName: "Souza",
      phone: "(11) 98765-4321",
      document: "529.982.247-25",
    },
    billingAddress: {
      postalCode: "13201-000",
      addressLine1: "Rua Rangel Pestana",
      number: "10",
      addressLine2: "",
      neighborhood: "Centro",
      city: "Jundiaí",
      state: "SP",
      country: "BR",
      recipientName: "Maria Souza",
    },
    acceptsTerms: true,
  };
  assert.equal(checkoutSchema.safeParse({ ...base, whatsappOptIn: true }).success, true);
  assert.equal(checkoutSchema.safeParse({ ...base, whatsappOptIn: false }).success, true);
});

test("a caixa de opt-in fica junto do telefone, com o texto aprovado", () => {
  const contact = read("components/Checkout/CheckoutContactForm.tsx");
  const optIn = read("components/Checkout/CheckoutWhatsAppOptIn.tsx");
  assert.ok(contact.includes("<CheckoutWhatsAppOptIn />"));
  assert.ok(contact.indexOf("checkout-phone") < contact.indexOf("<CheckoutWhatsAppOptIn />"));
  assert.ok(optIn.includes('register("whatsappOptIn")'));
  assert.ok(optIn.includes("Quero receber atualizações do pedido e lembretes do meu carrinho pelo"));
  assert.ok(optIn.includes("WhatsApp"));
});

test("o opt-in sai do checkout só junto do pagamento, como campo opcional", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.ok(form.includes("whatsappOptIn: values.whatsappOptIn,"));
  // Nada de opt-in nas etapas de endereço, frete ou total.
  assert.ok(!form.includes("calculateShippingPostcode(whatsappOptIn"));
});

test("o contrato descreve cart.updated, pedido com sessao e o endpoint recuperar", () => {
  const doc = read("docs/contrato-carrinho-crm.md");
  for (const trecho of [
    "X-Site-Webhook-Key",
    '"evento": "cart.updated"',
    '"optin_whatsapp"',
    "POST {PAINEL_URL}/api/webhooks/site/recuperar",
    "token_invalido",
    "token_expirado",
    "carrinho_convertido",
    "SHA-256",
    "30 dias",
    '"sessao"',
    "PAINEL_ENVIAR_CARRINHO",
    "PAINEL_RECUPERAR_CARRINHO",
  ]) {
    assert.ok(doc.includes(trecho), `falta no contrato: ${trecho}`);
  }
  // Nada de CPF/CNPJ nem pagamento nos exemplos de payload.
  const exemplos = doc.split("```json").slice(1).map((bloco) => bloco.split("```")[0]).join("\n");
  assert.ok(!/cpf|cnpj|documento|cartao|cartão|cvv|senha/i.test(exemplos));
});
