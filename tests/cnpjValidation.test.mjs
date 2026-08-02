import assert from "node:assert/strict";
import test from "node:test";
import { isValidBrazilianCnpj } from "../lib/validation/cnpj.ts";

test("aceita CNPJ válido conhecido, com ou sem máscara", () => {
  assert.equal(isValidBrazilianCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidBrazilianCnpj("11222333000181"), true);
});

test("rejeita CNPJ com todos os dígitos iguais", () => {
  assert.equal(isValidBrazilianCnpj("11.111.111/1111-11"), false);
});

test("rejeita CNPJ com dígito verificador incorreto", () => {
  assert.equal(isValidBrazilianCnpj("11.222.333/0001-82"), false);
});

test("rejeita entrada com tamanho diferente de 14 dígitos", () => {
  assert.equal(isValidBrazilianCnpj(""), false);
  assert.equal(isValidBrazilianCnpj("123"), false);
  assert.equal(isValidBrazilianCnpj("11144477735"), false);
});
