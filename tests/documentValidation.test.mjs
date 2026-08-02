import assert from "node:assert/strict";
import test from "node:test";
import {
  detectBrazilianDocumentType,
  isValidBrazilianDocument,
} from "../lib/validation/document.ts";

test("detecta CPF pelo tamanho de 11 dígitos", () => {
  assert.equal(detectBrazilianDocumentType("111.444.777-35"), "cpf");
});

test("detecta CNPJ pelo tamanho de 14 dígitos", () => {
  assert.equal(detectBrazilianDocumentType("11.222.333/0001-81"), "cnpj");
});

test("retorna null para tamanho que não é CPF nem CNPJ", () => {
  assert.equal(detectBrazilianDocumentType("123"), null);
  assert.equal(detectBrazilianDocumentType(""), null);
});

test("isValidBrazilianDocument valida CPF e CNPJ corretos", () => {
  assert.equal(isValidBrazilianDocument("111.444.777-35"), true);
  assert.equal(isValidBrazilianDocument("11.222.333/0001-81"), true);
});

test("isValidBrazilianDocument rejeita CPF ou CNPJ com dígito verificador errado", () => {
  assert.equal(isValidBrazilianDocument("111.444.777-36"), false);
  assert.equal(isValidBrazilianDocument("11.222.333/0001-82"), false);
});

test("isValidBrazilianDocument rejeita tamanho que não é CPF nem CNPJ", () => {
  assert.equal(isValidBrazilianDocument("123"), false);
  assert.equal(isValidBrazilianDocument(""), false);
});
