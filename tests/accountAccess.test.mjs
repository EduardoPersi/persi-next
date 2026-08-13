import assert from "node:assert/strict";
import test from "node:test";
import {
  parseForgotPayload,
  parseRegisterPayload,
  RECOVERY_MESSAGE,
} from "../lib/account/access.ts";
import { AccountValidationError } from "../lib/account/validation.ts";
import {
  forgotAccountPassword,
  registerAccount,
} from "../services/account/access.ts";
import { AccountServiceError } from "../services/account/client.ts";

const config = {
  endpoint: "https://loja.persimateriais.com.br/wp-json/persi-account/v1",
  keyId: "primary",
  origin: "https://frontend.example.test",
  secret: "test-secret-placeholder",
};
const valid = {
  name: "Ana Cliente",
  email: "ana@example.test",
  phone: "",
  cpf: "",
  password: "segura123",
  passwordConfirmation: "segura123",
  acceptTerms: true,
  recaptchaToken: "test-recaptcha-token",
};

function assertValidationCode(payload, expectedCode) {
  assert.throws(
    () => parseRegisterPayload(JSON.stringify(payload)),
    (error) => {
      assert.ok(error instanceof AccountValidationError);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
}

test("cadastro normaliza CPF e telefone opcionais ausentes", () => {
  const withoutOptionals = { ...valid };
  delete withoutOptionals.phone;
  delete withoutOptionals.cpf;
  assert.deepEqual(parseRegisterPayload(JSON.stringify(withoutOptionals)), valid);
});

test("cadastro aceita CPF vazio", () => {
  assert.deepEqual(parseRegisterPayload(JSON.stringify(valid)), valid);
});

test("cadastro aceita telefone vazio, com 10 ou 11 dígitos", () => {
  for (const phone of ["", "1133334444", "11999998888"]) {
    assert.equal(
      parseRegisterPayload(JSON.stringify({ ...valid, phone })).phone,
      phone,
    );
  }
  assert.equal(
    parseRegisterPayload(
      JSON.stringify({ ...valid, phone: "(11) 99999-8888" }),
    ).phone,
    "11999998888",
  );
});

test("cadastro rejeita senha de 7 caracteres e aceita 8", () => {
  assertValidationCode(
    {
      ...valid,
      password: "1234567",
      passwordConfirmation: "1234567",
    },
    "ACCOUNT_REGISTER_PASSWORD_INVALID",
  );
  assert.equal(
    parseRegisterPayload(
      JSON.stringify({
        ...valid,
        password: "12345678",
        passwordConfirmation: "12345678",
      }),
    ).password.length,
    8,
  );
});

test("cadastro rejeita confirmação diferente e termos false", () => {
  assertValidationCode(
    { ...valid, passwordConfirmation: "outra123" },
    "ACCOUNT_REGISTER_PASSWORD_MISMATCH",
  );
  assertValidationCode(
    { ...valid, acceptTerms: false },
    "ACCOUNT_REGISTER_TERMS_REQUIRED",
  );
});

test("contrato de cadastro rejeita propriedades desconhecidas", () => {
  assertValidationCode(
    { ...valid, role: "administrator" },
    "ACCOUNT_REGISTER_PAYLOAD_INVALID",
  );
});

test("recuperação valida e-mail", () => {
  assert.deepEqual(
    parseForgotPayload(
      '{"email":"ANA@example.test","recaptchaToken":"test-recaptcha-token"}',
    ),
    { email: "ana@example.test", recaptchaToken: "test-recaptcha-token" },
  );
  assert.throws(() =>
    parseForgotPayload(
      '{"email":"invalido","recaptchaToken":"test-recaptcha-token"}',
    ),
  );
});

test("cadastro público não retorna IDs, token, senha ou segredo", async () => {
  const result = await registerAccount(valid, {
    config,
    fetchImplementation: async () =>
      Response.json({ registered: true }, { status: 201 }),
  });
  assert.deepEqual(result, { registered: true });
  assert.equal(
    JSON.stringify(result).match(/user|customer|token|password|secret/i),
    null,
  );
});

test("e-mail duplicado e 401 do WordPress preservam o status", async () => {
  for (const status of [409, 401]) {
    await assert.rejects(
      registerAccount(valid, {
        config,
        fetchImplementation: async () => Response.json({}, { status }),
      }),
      (error) =>
        error instanceof AccountServiceError && error.status === status,
    );
  }
});

test("recuperação existente ou inexistente tem resposta genérica", async () => {
  for (const status of [200, 200]) {
    const result = await forgotAccountPassword("ana@example.test", {
      config,
      fetchImplementation: async () =>
        Response.json({ message: "interno" }, { status }),
    });
    assert.equal(result.message, RECOVERY_MESSAGE);
  }
});

test("rate limit remoto é preservado", async () => {
  await assert.rejects(
    registerAccount(valid, {
      config,
      fetchImplementation: async () => Response.json({}, { status: 429 }),
    }),
    (error) => error instanceof AccountServiceError && error.status === 429,
  );
});
