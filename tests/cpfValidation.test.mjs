import assert from "node:assert/strict";
import test from "node:test";
import { isValidBrazilianCpf } from "../lib/validation/cpf.ts";

test("aceita CPFs válidos conhecidos, com ou sem máscara", () => {
  assert.equal(isValidBrazilianCpf("111.444.777-35"), true);
  assert.equal(isValidBrazilianCpf("11144477735"), true);
});

test("rejeita CPF com todos os dígitos iguais", () => {
  assert.equal(isValidBrazilianCpf("111.111.111-11"), false);
  assert.equal(isValidBrazilianCpf("00000000000"), false);
});

test("rejeita CPF com dígito verificador incorreto", () => {
  assert.equal(isValidBrazilianCpf("111.444.777-36"), false);
});

test("rejeita entrada com tamanho diferente de 11 dígitos", () => {
  assert.equal(isValidBrazilianCpf(""), false);
  assert.equal(isValidBrazilianCpf("123"), false);
  assert.equal(isValidBrazilianCpf("111444777350"), false);
});
