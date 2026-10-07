import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_PREFILL_TTL_MS,
  hasCheckoutPrefillParams,
  mergeCheckoutPrefill,
  parseCheckoutPrefillParams,
  parseStoredCheckoutPrefill,
  serializeCheckoutPrefill,
  stripCheckoutPrefillParams,
} from "../lib/commerce/checkoutPrefill.ts";
import { checkoutDefaultValues } from "../lib/validation/checkout.ts";

const parse = (query) => parseCheckoutPrefillParams(new URLSearchParams(query));

test("lê todos os parâmetros e formata telefone, CPF e CEP", () => {
  const prefill = parse(
    "nome=Maria&sobrenome=Souza&email=Maria@Example.com&whatsapp=11987654321" +
      "&cpf=52998224725&cep=13201000&cidade=Jundiaí&estado=sp&endereco=Rua Rangel Pestana&bairro=Centro",
  );
  assert.deepEqual(prefill, {
    firstName: "Maria",
    lastName: "Souza",
    email: "maria@example.com",
    phone: "(11) 98765-4321",
    document: "529.982.247-25",
    postalCode: "13201-000",
    city: "Jundiaí",
    state: "SP",
    address: "Rua Rangel Pestana",
    neighborhood: "Centro",
  });
});

test("aliases do telefone: whatsapp vence telefone, phone e cel", () => {
  assert.equal(parse("telefone=11911112222")?.phone, "(11) 91111-2222");
  assert.equal(parse("phone=11911112222")?.phone, "(11) 91111-2222");
  assert.equal(parse("cel=11911112222")?.phone, "(11) 91111-2222");
  assert.equal(
    parse("cel=11911112222&whatsapp=11933334444")?.phone,
    "(11) 93333-4444",
  );
});

test("telefone aceita +55, máscara e rejeita tamanho errado", () => {
  assert.equal(parse("whatsapp=+55 (11) 98765-4321")?.phone, "(11) 98765-4321");
  assert.equal(parse("whatsapp=5511987654321")?.phone, "(11) 98765-4321");
  assert.equal(parse("whatsapp=987654321"), null);
  assert.equal(parse("whatsapp=119876543210000"), null);
});

test("valores inválidos são descartados em silêncio", () => {
  assert.equal(parse("cpf=11111111111"), null);
  assert.equal(parse("cpf=12345678900"), null);
  assert.equal(parse("email=nao-e-email"), null);
  assert.equal(parse("cep=123"), null);
  assert.equal(parse("estado=XX"), null);
  assert.equal(parse("nome="), null);
  assert.equal(parse("utm_source=google&gclid=abc"), null);
});

test("remove HTML e caracteres de controle e limita o tamanho", () => {
  const prefill = parse(
    "nome=<script>alert(1)</script>Maria&endereco=Rua%20%3Cb%3EA%3C/b%3E%0A%00,%20100&bairro=" +
      "x".repeat(150),
  );
  // As tags somem e o nome só aceita letras, espaço, apóstrofo, ponto e hífen.
  assert.equal(prefill?.firstName, "alertMaria");
  assert.doesNotMatch(prefill?.firstName ?? "", /[<>()/]/);
  assert.equal(parse("nome=<b>Ana</b>")?.firstName, "Ana");
  assert.doesNotMatch(prefill?.address ?? "", /[<>\n\0]/);
  assert.equal(prefill?.neighborhood?.length, 60);
});

test("nome completo no campo nome é dividido quando não há sobrenome", () => {
  const prefill = parse("nome=Maria da Silva Souza");
  assert.equal(prefill?.firstName, "Maria");
  assert.equal(prefill?.lastName, "da Silva Souza");
  const both = parse("nome=Maria&sobrenome=Souza");
  assert.equal(both?.firstName, "Maria");
  assert.equal(both?.lastName, "Souza");
});

test("detecta e remove só os parâmetros de pré-preenchimento da URL", () => {
  const search = "?nome=Maria&utm_source=google&cep=13201000&step=address&gclid=x";
  assert.equal(hasCheckoutPrefillParams(search), true);
  assert.equal(hasCheckoutPrefillParams("?utm_source=google"), false);
  assert.equal(
    stripCheckoutPrefillParams(search),
    "?utm_source=google&step=address&gclid=x",
  );
  assert.equal(stripCheckoutPrefillParams("?nome=Maria&cpf=1"), "");
});

test("guardado na sessão: ida e volta, expiração e lixo", () => {
  const now = 1_800_000_000_000;
  const prefill = parse("nome=Maria&sobrenome=Souza&whatsapp=11987654321&cep=13201000");
  const raw = serializeCheckoutPrefill(prefill, now);
  assert.deepEqual(parseStoredCheckoutPrefill(raw, now + 1000), prefill);
  assert.equal(
    parseStoredCheckoutPrefill(raw, now + CHECKOUT_PREFILL_TTL_MS + 1),
    null,
  );
  assert.equal(parseStoredCheckoutPrefill("{lixo", now), null);
  assert.equal(parseStoredCheckoutPrefill(null, now), null);
  assert.equal(
    parseStoredCheckoutPrefill(JSON.stringify({ v: 2, savedAt: now, prefill }), now),
    null,
  );
});

test("o que foi guardado passa pela sanitização de novo", () => {
  const now = 1_800_000_000_000;
  const raw = JSON.stringify({
    v: 1,
    savedAt: now,
    prefill: { firstName: "<b>Ana</b>", document: "11111111111", state: "ZZ", phone: "123" },
  });
  const prefill = parseStoredCheckoutPrefill(raw, now);
  assert.equal(prefill?.firstName?.includes("<"), false);
  assert.equal(prefill?.document, undefined);
  assert.equal(prefill?.state, undefined);
  assert.equal(prefill?.phone, undefined);
});

test("mescla só preenche campos vazios e nunca mexe no e-mail", () => {
  const prefill = parse(
    "nome=Maria&sobrenome=Souza&email=outro@example.com&whatsapp=11987654321&cep=13201000&cidade=Jundiaí&estado=SP&cpf=52998224725",
  );
  const current = {
    ...checkoutDefaultValues,
    contact: {
      ...checkoutDefaultValues.contact,
      email: "conta@example.com",
      firstName: "Ana",
    },
  };
  const merged = mergeCheckoutPrefill(current, prefill);
  assert.equal(merged.contact.firstName, "Ana");
  assert.equal(merged.contact.lastName, "Souza");
  assert.equal(merged.contact.email, "conta@example.com");
  assert.equal(merged.contact.phone, "(11) 98765-4321");
  assert.equal(merged.contact.document, "529.982.247-25");
  assert.equal(merged.contact.personType, "fisica");
  assert.equal(merged.billingAddress.postalCode, "13201-000");
  assert.equal(merged.billingAddress.city, "Jundiaí");
  assert.equal(merged.billingAddress.state, "SP");
});

test("CPF do link não troca PJ já escolhido quando o documento já existe", () => {
  const prefill = parse("cpf=52998224725");
  const current = {
    ...checkoutDefaultValues,
    contact: {
      ...checkoutDefaultValues.contact,
      personType: "juridica",
      document: "11.222.333/0001-81",
    },
  };
  const merged = mergeCheckoutPrefill(current, prefill);
  assert.equal(merged.contact.personType, "juridica");
  assert.equal(merged.contact.document, "11.222.333/0001-81");
});
