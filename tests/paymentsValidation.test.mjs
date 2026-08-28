import assert from "node:assert/strict";
import test from "node:test";
import { paymentInitiationSchema } from "../lib/validation/payments.ts";

const idempotencyKey = "5b1f6f2a-3b0e-4f2a-9a8e-2f5a6b0c1d2e";

test("aceita inter_pix com CPF válido", () => {
  const result = paymentInitiationSchema.safeParse({
    method: "inter_pix",
    idempotencyKey,
    document: "111.444.777-35",
  });
  assert.equal(result.success, true);
});

test("aceita inter_pix e inter_boleto com CNPJ válido", () => {
  for (const method of ["inter_pix", "inter_boleto"]) {
    assert.equal(
      paymentInitiationSchema.safeParse({
        method,
        idempotencyKey,
        document: "11.222.333/0001-81",
      }).success,
      true,
    );
  }
});

test("rejeita inter_pix com CPF inválido", () => {
  const result = paymentInitiationSchema.safeParse({
    method: "inter_pix",
    idempotencyKey,
    document: "111.111.111-11",
  });
  assert.equal(result.success, false);
});

test("rejeita payload com campos extras (contrato fechado)", () => {
  const result = paymentInitiationSchema.safeParse({
    method: "inter_pix",
    idempotencyKey,
    document: "111.444.777-35",
    amount: 999,
  });
  assert.equal(result.success, false);
});

test("mercadopago_card exige installments inteiro entre 1 e 12", () => {
  const base = {
    method: "mercadopago_card",
    idempotencyKey,
    cardToken: "tok_abc",
    paymentMethodId: "visa",
    holderDocument: "111.444.777-35",
  };
  assert.equal(
    paymentInitiationSchema.safeParse({ ...base, installments: 3 }).success,
    true,
  );
  assert.equal(
    paymentInitiationSchema.safeParse({ ...base, installments: 0 }).success,
    false,
  );
  assert.equal(
    paymentInitiationSchema.safeParse({ ...base, installments: 13 }).success,
    false,
  );
});

test("mercadopago_card também aceita CNPJ como holderDocument", () => {
  assert.equal(
    paymentInitiationSchema.safeParse({
      method: "mercadopago_card",
      idempotencyKey,
      cardToken: "tok_abc",
      installments: 1,
      paymentMethodId: "visa",
      holderDocument: "11.222.333/0001-81",
    }).success,
    true,
  );
});

test("mercadopago_card exige paymentMethodId, mas issuerId é opcional", () => {
  const base = {
    method: "mercadopago_card",
    idempotencyKey,
    cardToken: "tok_abc",
    installments: 1,
    holderDocument: "111.444.777-35",
  };
  assert.equal(paymentInitiationSchema.safeParse(base).success, false);
  assert.equal(
    paymentInitiationSchema.safeParse({ ...base, paymentMethodId: "visa" }).success,
    true,
  );
  assert.equal(
    paymentInitiationSchema.safeParse({
      ...base,
      paymentMethodId: "visa",
      issuerId: "123",
    }).success,
    true,
  );
});

test("pagbank_apple_pay e google_pay exigem CPF ou CNPJ do titular", () => {
  assert.equal(
    paymentInitiationSchema.safeParse({
      method: "pagbank_apple_pay",
      idempotencyKey,
      token: "tok_apple",
      holderDocument: "111.444.777-35",
    }).success,
    true,
  );
  assert.equal(
    paymentInitiationSchema.safeParse({
      method: "pagbank_google_pay",
      idempotencyKey,
      token: "tok_google",
    }).success,
    false,
  );
});

test("rejeita método desconhecido", () => {
  const result = paymentInitiationSchema.safeParse({
    method: "boleto_bradesco",
    idempotencyKey,
  });
  assert.equal(result.success, false);
});

test("aceita customerNote opcional e continua fechado a outros campos extras", () => {
  const result = paymentInitiationSchema.safeParse({
    method: "inter_pix",
    idempotencyKey,
    document: "111.444.777-35",
    customerNote: "Entregar após as 18h.",
  });
  assert.equal(result.success, true);

  const withoutNote = paymentInitiationSchema.safeParse({
    method: "inter_pix",
    idempotencyKey,
    document: "111.444.777-35",
  });
  assert.equal(withoutNote.success, true);
});

test("idempotencyKey precisa ser um UUID", () => {
  const result = paymentInitiationSchema.safeParse({
    method: "inter_pix",
    idempotencyKey: "not-a-uuid",
    document: "111.444.777-35",
  });
  assert.equal(result.success, false);
});
