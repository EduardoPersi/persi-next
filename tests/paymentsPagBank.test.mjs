import assert from "node:assert/strict";
import test from "node:test";
import { createCardCharge, getCardChargeStatus } from "../services/payments/pagbank/charge.ts";

// `services/payments/pagbank/client.ts` importa "server-only" (o Bearer
// token do PagBank nunca pode rodar fora de um contexto de servidor) e por
// isso, como os demais módulos com essa guarda no projeto, não é importado
// diretamente por testes unitários.

process.env.APP_BASE_URL = "https://persimateriais.com.br";

test("createCardCharge monta o pedido e extrai a primeira cobrança", async () => {
  const calls = [];
  const request = async (path, method, body) => {
    calls.push({ path, method, body });
    return {
      charges: [{ id: "CHAR1", status: "PAID", amount: { value: 19990 } }],
    };
  };

  const result = await createCardCharge(
    {
      referenceId: "100",
      amount: 199.9,
      cardToken: "tok_abc",
      installments: 3,
      paymentMethod: "credit_card",
      holderDocument: "12345678909",
      holderName: "Maria Silva",
      holderEmail: "maria@example.com",
    },
    request,
  );

  assert.equal(result.chargeId, "CHAR1");
  assert.equal(result.status, "PAID");
  assert.equal(result.amount, 199.9);
  assert.equal(calls[0].path, "/orders");
  assert.equal(calls[0].body.charges[0].payment_method.type, "CREDIT_CARD");
  assert.equal(calls[0].body.charges[0].payment_method.card.encrypted, "tok_abc");
  assert.equal(calls[0].body.charges[0].amount.value, 19990);
  assert.deepEqual(calls[0].body.notification_urls, [
    "https://persimateriais.com.br/api/webhooks/pagbank",
  ]);
  assert.equal(calls[0].body.customer.tax_id, "12345678909");
});

test("createCardCharge remove máscara do documento antes de enviar como tax_id", async () => {
  const calls = [];
  const request = async (_path, _method, body) => {
    calls.push({ body });
    return { charges: [{ id: "CHAR4", status: "PAID", amount: { value: 10000 } }] };
  };

  await createCardCharge(
    {
      referenceId: "104",
      amount: 100,
      cardToken: "tok_cnpj",
      installments: 1,
      paymentMethod: "credit_card",
      holderDocument: "11.222.333/0001-81",
      holderName: "Empresa LTDA",
      holderEmail: "empresa@example.com",
    },
    request,
  );

  assert.equal(calls[0].body.customer.tax_id, "11222333000181");
});

test("createCardCharge mapeia apple_pay/google_pay para o tipo esperado pelo PagBank", async () => {
  const request = async () => ({
    charges: [{ id: "CHAR2", status: "AUTHORIZED", amount: { value: 5000 } }],
  });

  const applePay = await createCardCharge(
    {
      referenceId: "101",
      amount: 50,
      cardToken: "tok_apple",
      installments: 1,
      paymentMethod: "apple_pay",
      holderDocument: "12345678909",
      holderName: "Maria Silva",
      holderEmail: "maria@example.com",
    },
    request,
  );
  assert.equal(applePay.status, "AUTHORIZED");
});

test("createCardCharge falha quando a resposta não traz nenhuma cobrança", async () => {
  const request = async () => ({ charges: [] });

  await assert.rejects(
    createCardCharge(
      {
        referenceId: "102",
        amount: 10,
        cardToken: "tok_x",
        installments: 1,
        paymentMethod: "credit_card",
        holderDocument: "12345678909",
        holderName: "A",
        holderEmail: "a@example.com",
      },
      request,
    ),
    /Resposta de cobrança do PagBank inválida/,
  );
});

test("createCardCharge rejeita status de cobrança desconhecido", async () => {
  const request = async () => ({
    charges: [{ id: "CHAR3", status: "SOMETHING_NEW", amount: { value: 100 } }],
  });

  await assert.rejects(
    createCardCharge(
      {
        referenceId: "103",
        amount: 1,
        cardToken: "tok_x",
        installments: 1,
        paymentMethod: "credit_card",
        holderDocument: "12345678909",
        holderName: "A",
        holderEmail: "a@example.com",
      },
      request,
    ),
    /Status de cobrança do PagBank desconhecido/,
  );
});

test("getCardChargeStatus reconsulta a cobrança pelo id", async () => {
  const request = async (path, method) => {
    assert.equal(path, "/charges/CHAR9");
    assert.equal(method, "GET");
    return { id: "CHAR9", status: "DECLINED", amount: { value: 1000 } };
  };

  const result = await getCardChargeStatus("CHAR9", request);
  assert.equal(result.status, "DECLINED");
  assert.equal(result.amount, 10);
});
