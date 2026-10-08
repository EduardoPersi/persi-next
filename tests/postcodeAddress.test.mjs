import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  POSTCODE_BOUND_FIELDS,
  addressFieldsFromLookup,
} from "../lib/commerce/postcodeAddress.ts";

test("endereço completo: tudo vem do CEP novo e está resolvido", () => {
  const fields = addressFieldsFromLookup({
    address1: "Rua Rangel Pestana",
    address2: "Centro",
    city: "Jundiaí",
    state: "sp",
    postcode: "13201-000",
    country: "BR",
  });
  assert.deepEqual(fields, {
    addressLine1: "Rua Rangel Pestana",
    neighborhood: "Centro",
    city: "Jundiaí",
    state: "SP",
    resolved: true,
    neighborhoodMissing: false,
  });
});

test("CEP geral de cidade pequena (Itupeva): só cidade e UF, sem rua — não está resolvido", () => {
  const fields = addressFieldsFromLookup({ city: "Itupeva", state: "SP", postcode: "13295-000", country: "BR" });
  assert.equal(fields.city, "Itupeva");
  assert.equal(fields.state, "SP");
  assert.equal(fields.addressLine1, "");
  assert.equal(fields.neighborhood, "");
  assert.equal(fields.resolved, false);
  assert.equal(fields.neighborhoodMissing, false);
});

test("rua sem bairro: resolvido, e pede o bairro", () => {
  const fields = addressFieldsFromLookup({ address1: "Rua A", city: "Jundiaí", state: "SP" });
  assert.equal(fields.resolved, true);
  assert.equal(fields.neighborhoodMissing, true);
});

test("CEP não encontrado ou falha: tudo vazio e não resolvido", () => {
  for (const vazio of [null, undefined, {}]) {
    const fields = addressFieldsFromLookup(vazio);
    assert.equal(fields.resolved, false);
    assert.equal(fields.addressLine1 + fields.neighborhood + fields.city + fields.state, "");
  }
});

test("espaços e valores em branco não contam como endereço", () => {
  const fields = addressFieldsFromLookup({ address1: "  ", city: "  ", state: " " });
  assert.equal(fields.resolved, false);
  assert.equal(fields.city, "");
});

test("os campos presos ao CEP são rua, bairro, cidade e UF (número e complemento são do cliente)", () => {
  assert.deepEqual([...POSTCODE_BOUND_FIELDS], ["addressLine1", "neighborhood", "city", "state"]);
});

test("o formulário limpa o endereço antigo ao trocar o CEP e aplica o resultado do CEP novo", () => {
  const fonte = readFileSync("components/Checkout/CheckoutAddressFields.tsx", "utf8");
  // Limpa na hora (antes da busca responder), só quando o CEP mudou de verdade.
  assert.match(fonte, /if \(postcodeChanged\) \{[\s\S]*?POSTCODE_BOUND_FIELDS[\s\S]*?\}/);
  // Aplica o resultado, inclusive o parcial, e abre os campos manuais quando não resolveu.
  assert.match(fonte, /addressFieldsFromLookup\(address\)/);
  assert.match(fonte, /setAddressLookupFailed\(!fields\.resolved\)/);
  assert.match(fonte, /if \(fields\.neighborhoodMissing\) setNeighborhoodBackfillFailed\(true\)/);
  // A versão antiga deixava o endereço antigo quando faltava a rua.
  assert.doesNotMatch(fonte, /!address\?\.address1 \|\| !address\.city \|\| !address\.state/);
});
