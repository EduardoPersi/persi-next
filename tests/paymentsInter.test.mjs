import assert from "node:assert/strict";
import test from "node:test";
import {
  createPixCharge,
  getPixChargeStatus,
  isPixChargeExpired,
} from "../services/payments/inter/pix.ts";
import {
  createBoletoCharge,
  getBoletoChargeStatus,
  getBoletoDueDate,
} from "../services/payments/inter/boleto.ts";

// `services/payments/inter/client.ts` importa "server-only" (mTLS/OAuth2 do
// Banco Inter nunca pode rodar fora de um contexto de servidor) e por isso,
// como os demais módulos com essa guarda no projeto (ver
// services/woocommerce/restClient.ts), não é importado diretamente por
// testes unitários — sua validação de configuração é coberta pelo teste de
// smoke em sandbox (fase 7 do plano) e por `tests/paymentsEnvGuard.test.mjs`.

const billingAddress = {
  firstName: "Maria",
  lastName: "Silva",
  address1: "Rua do Rosário, 1",
  city: "Jundiaí",
  state: "SP",
  postcode: "13201000",
  country: "BR",
};

test("createPixCharge monta cobrança a partir do cob e gera a imagem do QR Code a partir do copia e cola, sempre com expiração de 3600s", async () => {
  process.env.INTER_PIX_KEY = "chave-pix-teste";
  const calls = [];
  const request = async (path, method, body) => {
    calls.push({ path, method, body });
    return {
      txid: "TX123",
      status: "ATIVA",
      calendario: { criacao: "2026-08-02T10:00:00Z", expiracao: 3600 },
      pixCopiaECola: "00020126...copia-e-cola",
    };
  };

  const charge = await createPixCharge(
    {
      txid: "TX123",
      amount: 199.9,
      payerDocument: "12345678909",
      payerName: "Maria Silva",
      description: "Pedido 100",
    },
    request,
  );

  assert.equal(charge.txid, "TX123");
  assert.equal(charge.status, "ATIVA");
  assert.equal(charge.qrCodeCopyPaste, "00020126...copia-e-cola");
  // A imagem é gerada localmente (não vem do Inter): confirma que é um PNG
  // válido em base64, sem depender de uma segunda chamada à API.
  assert.match(charge.qrCodeImageBase64, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(
    Buffer.from(charge.qrCodeImageBase64, "base64").subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/pix/v2/cob/TX123");
  assert.equal(calls[0].body.calendario.expiracao, 3600);
  assert.equal(calls[0].body.valor.original, "199.90");
  assert.equal(calls[0].body.chave, "chave-pix-teste");
});

test("createPixCharge envia devedor.cpf para documento de 11 dígitos e devedor.cnpj para 14", async () => {
  process.env.INTER_PIX_KEY = "chave-pix-teste";
  const calls = [];
  const request = async (path, method, body) => {
    calls.push({ method, body });
    return {
      txid: "TX1",
      status: "ATIVA",
      calendario: { criacao: "2026-08-02T10:00:00Z", expiracao: 3600 },
      pixCopiaECola: "codigo",
    };
  };

  await createPixCharge(
    {
      txid: "TX1",
      amount: 10,
      payerDocument: "12345678909",
      payerName: "Pessoa Física",
      description: "x",
    },
    request,
  );
  await createPixCharge(
    {
      txid: "TX1",
      amount: 10,
      payerDocument: "11.222.333/0001-81",
      payerName: "Empresa LTDA",
      description: "x",
    },
    request,
  );

  assert.deepEqual(calls[0].body.devedor, { cpf: "12345678909", nome: "Pessoa Física" });
  assert.deepEqual(calls[1].body.devedor, { cnpj: "11222333000181", nome: "Empresa LTDA" });
});

test("createPixCharge falha sem INTER_PIX_KEY configurada", async () => {
  delete process.env.INTER_PIX_KEY;
  await assert.rejects(
    createPixCharge(
      {
        txid: "TX1",
        amount: 10,
        payerDocument: "12345678909",
        payerName: "A",
        description: "x",
      },
      async () => ({}),
    ),
    /INTER_PIX_KEY/,
  );
});

test("createPixCharge rejeita cobrança sem código copia e cola", async () => {
  process.env.INTER_PIX_KEY = "chave-pix-teste";
  const request = async () => ({
    txid: "TX1",
    status: "ATIVA",
    calendario: { criacao: "2026-08-02T10:00:00Z", expiracao: 3600 },
  });

  await assert.rejects(
    createPixCharge(
      {
        txid: "TX1",
        amount: 10,
        payerDocument: "12345678909",
        payerName: "A",
        description: "x",
      },
      request,
    ),
    /código copia e cola/,
  );
});

test("getPixChargeStatus reconsulta a cobrança e valida o status recebido", async () => {
  const request = async (path, method) => {
    assert.equal(path, "/pix/v2/cob/TX999");
    assert.equal(method, "GET");
    return {
      txid: "TX999",
      status: "CONCLUIDA",
      calendario: { criacao: "2026-08-02T10:00:00Z", expiracao: 3600 },
    };
  };

  const result = await getPixChargeStatus("TX999", request);
  assert.equal(result.status, "CONCLUIDA");
});

test("getPixChargeStatus rejeita status desconhecido do provedor", async () => {
  const request = async () => ({
    txid: "TX1",
    status: "ALGO_NOVO",
    calendario: { criacao: "2026-08-02T10:00:00Z", expiracao: 3600 },
  });

  await assert.rejects(getPixChargeStatus("TX1", request), /Status de cobrança Pix desconhecido/);
});

test("isPixChargeExpired só é true para cobrança ATIVA com expiresAt no passado", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 1000).toISOString();
  assert.equal(isPixChargeExpired({ status: "ATIVA", expiresAt: past }), true);
  assert.equal(isPixChargeExpired({ status: "ATIVA", expiresAt: future }), false);
  assert.equal(isPixChargeExpired({ status: "CONCLUIDA", expiresAt: past }), false);
});

test("getBoletoDueDate calcula sempre 2 dias corridos a partir da data de referência", () => {
  assert.equal(getBoletoDueDate(new Date("2026-08-02T10:00:00Z")), "2026-08-04");
  assert.equal(getBoletoDueDate(new Date("2026-12-30T23:00:00Z")), "2027-01-01");
});

test("createBoletoCharge cria com vencimento D+2 e reconsulta para retornar linha digitável", async () => {
  const calls = [];
  const request = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === "POST") return { codigoSolicitacao: "REQ1" };
    return {
      cobranca: { situacao: "A_RECEBER", dataVencimento: getBoletoDueDate() },
      boleto: { linhaDigitavel: "34191...", codigoBarras: "341...9" },
    };
  };

  const charge = await createBoletoCharge(
    {
      seuNumero: "PEDIDO-100",
      amount: 250,
      payerDocument: "12345678909",
      payerName: "Maria Silva",
      billingAddress,
    },
    request,
  );

  assert.equal(charge.requestCode, "REQ1");
  assert.equal(charge.status, "A_RECEBER");
  assert.equal(charge.digitableLine, "34191...");
  assert.equal(charge.dueDate, getBoletoDueDate());
  assert.equal(calls[0].path, "/cobranca/v3/cobrancas");
  assert.equal(calls[1].path, "/cobranca/v3/cobrancas/REQ1");
  assert.equal(calls[0].body.dataVencimento, getBoletoDueDate());
  assert.equal(calls[0].body.pagador.cpfCnpj, "12345678909");
  assert.equal(calls[0].body.pagador.tipoPessoa, "FISICA");
  assert.equal(calls[0].body.valorNominal, 250);
});

test("createBoletoCharge usa tipoPessoa JURIDICA para CNPJ", async () => {
  await createBoletoCharge(
    {
      seuNumero: "PEDIDO-200",
      amount: 100,
      payerDocument: "11.222.333/0001-81",
      payerName: "Empresa LTDA",
      billingAddress,
    },
    async (path, method, body) => {
      if (method === "POST") {
        assert.equal(body.pagador.cpfCnpj, "11222333000181");
        assert.equal(body.pagador.tipoPessoa, "JURIDICA");
        return { codigoSolicitacao: "REQ2" };
      }
      return { cobranca: { situacao: "A_RECEBER" } };
    },
  );
});

test("getBoletoChargeStatus valida a situação recebida", async () => {
  const request = async () => ({
    cobranca: { situacao: "CANCELADO_DESCONHECIDO" },
  });

  await assert.rejects(getBoletoChargeStatus("REQ1", request), /Situação de boleto desconhecida/);
});
