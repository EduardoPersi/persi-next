import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBrazilianPhone,
  validateBrazilianPhone,
} from "../lib/account/phoneValidation.ts";
import { formatBrazilianCpf } from "../lib/formatting/personalData.ts";

test("máscara telefone fixo e celular brasileiro", () => {
  assert.equal(formatBrazilianPhone("1133334444"), "(11) 3333-4444");
  assert.equal(formatBrazilianPhone("11999998888"), "(11) 99999-8888");
  assert.equal(formatBrazilianPhone("1199999888899"), "(11) 99999-8888");
});

test("telefone opcional vazio e números brasileiros válidos são aceitos", () => {
  for (const phone of ["", "(11) 3333-4444", "(11) 99999-8888"]) {
    assert.equal(validateBrazilianPhone(phone), null);
  }
});

test("rejeita assinante composto por um único dígito repetido", () => {
  for (const digit of "0123456789") {
    assert.equal(
      validateBrazilianPhone(`(11) ${digit.repeat(5)}-${digit.repeat(4)}`),
      "Informe um telefone válido.",
    );
    assert.equal(
      validateBrazilianPhone(`(11) ${digit.repeat(4)}-${digit.repeat(4)}`),
      "Informe um telefone válido.",
    );
  }
});

test("rejeita DDD inexistente com mensagem específica", () => {
  for (const areaCode of ["00", "10", "20", "23", "25", "26", "29", "30"]) {
    assert.equal(
      validateBrazilianPhone(`(${areaCode}) 99999-8888`),
      "DDD inválido.",
    );
  }
});

test("valida quantidade e tipo de telefone brasileiro", () => {
  for (const phone of [
    "(11) 9999-888",
    "(11) 99999-888",
    "(11) 69999-8888",
    "(11) 9999-8888",
  ]) {
    assert.equal(
      validateBrazilianPhone(phone),
      "Informe um telefone válido.",
    );
  }
});

test("mascara CPF limita e organiza os onze digitos", () => {
  assert.equal(formatBrazilianCpf("12345678901"), "123.456.789-01");
  assert.equal(formatBrazilianCpf("123.456.789-0199"), "123.456.789-01");
  assert.equal(formatBrazilianCpf("123456"), "123.456");
});
