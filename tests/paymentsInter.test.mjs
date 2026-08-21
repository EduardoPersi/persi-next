import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPixChargeRequest,
  createPixCharge,
  getPixCreationDiagnostics,
  getPixChargeStatus,
  isPixChargeExpired,
} from "../services/payments/inter/pix.ts";
import {
  buildBoletoChargeRequest,
  createBoletoCharge,
  getBoletoCreationDiagnostics,
  getBoletoChargeStatus,
  getBoletoDueDate,
  getBoletoPdfBase64,
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

test("builder Pix preserva exatamente o contrato histórico funcional", () => {
  const request = buildPixChargeRequest({
    txid: "1234567890abcdef1234567890abcdef",
    amount: 57.55,
    payerDocument: "529.982.247-25",
    payerName: "Maria Silva",
    description: "Pedido 123",
  }, "pix-key");

  assert.deepEqual(request, {
    path: "/pix/v2/cob/1234567890abcdef1234567890abcdef",
    method: "PUT",
    body: {
      calendario: { expiracao: 3600 },
      devedor: { cpf: "52998224725", nome: "Maria Silva" },
      valor: { original: "57.55" },
      chave: "pix-key",
      solicitacaoPagador: "Pedido 123",
    },
  });
});

test("builder boleto preserva endpoint v3, CEP numérico e payload histórico", () => {
  const request = buildBoletoChargeRequest({
    seuNumero: "123",
    amount: 57.55,
    payerDocument: "529.982.247-25",
    payerName: "Maria Silva",
    billingAddress: { ...billingAddress, postcode: "13201-000" },
  }, "2026-08-23");

  assert.deepEqual(request, {
    path: "/cobranca/v3/cobrancas",
    method: "POST",
    body: {
      seuNumero: "123",
      valorNominal: 57.55,
      dataVencimento: "2026-08-23",
      numDiasAgenda: 60,
      pagador: {
        cpfCnpj: "52998224725",
        tipoPessoa: "FISICA",
        nome: "Maria Silva",
        endereco: billingAddress.address1,
        cidade: billingAddress.city,
        uf: "SP",
        cep: "13201000",
      },
    },
  });
});

test("diagnóstico de criação não expõe documento, chave Pix ou endereço", () => {
  process.env.INTER_PIX_KEY = "pix-key-real-nao-deve-aparecer";
  const pix = getPixCreationDiagnostics({
    txid: "1234567890abcdef1234567890abcdef",
    amount: 57.55,
    payerDocument: "529.982.247-25",
    payerName: "Maria Silva",
    description: "Pedido 123",
  });
  const boleto = getBoletoCreationDiagnostics({
    seuNumero: "123",
    amount: 57.55,
    payerDocument: "529.982.247-25",
    payerName: "Maria Silva",
    billingAddress,
  });
  const serialized = JSON.stringify({ pix, boleto });

  assert.doesNotMatch(serialized, /52998224725|pix-key-real-nao-deve-aparecer|Rua do/);
  assert.equal(pix.payload.amount, "57.55");
  assert.equal(boleto.payload.amount, "57.55");
  assert.equal(pix.headers.authorization, "redacted");
  assert.equal(boleto.headers.authorization, "redacted");
});

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

test("createBoletoCharge reconsulta até a cobrança sair de EM_PROCESSAMENTO e trazer a linha digitável", async () => {
  const calls = [];
  let getCount = 0;
  const request = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === "POST") return { codigoSolicitacao: "REQ1" };
    getCount += 1;
    // Emissão assíncrona no Inter: as duas primeiras consultas ainda pegam a
    // cobrança em processamento, só a terceira já traz a linha digitável.
    if (getCount < 3) {
      return { cobranca: { situacao: "EM_PROCESSAMENTO" } };
    }
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
    { pollIntervalMs: 0 },
  );

  assert.equal(charge.status, "A_RECEBER");
  assert.equal(charge.digitableLine, "34191...");
  // 1 POST + 3 GETs (a reconsulta inicial mais duas tentativas extras).
  assert.equal(calls.length, 4);
});

test("createBoletoCharge desiste depois do número máximo de tentativas e devolve o que tiver, sem lançar erro", async () => {
  let getCount = 0;
  const request = async (path, method) => {
    if (method === "POST") return { codigoSolicitacao: "REQ1" };
    getCount += 1;
    return { cobranca: { situacao: "EM_PROCESSAMENTO" } };
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
    { pollIntervalMs: 0, pollAttempts: 2 },
  );

  assert.equal(charge.status, "EM_PROCESSAMENTO");
  assert.equal(charge.digitableLine, "");
  // 1 reconsulta inicial + 2 tentativas extras, nunca mais que o limite.
  assert.equal(getCount, 3);
});

test("getBoletoPdfBase64 devolve o campo pdf da resposta", async () => {
  const calls = [];
  const request = async (path, method) => {
    calls.push({ path, method });
    return { pdf: "base64conteudo" };
  };

  const pdf = await getBoletoPdfBase64("REQ1", request);
  assert.equal(pdf, "base64conteudo");
  assert.equal(calls[0].path, "/cobranca/v3/cobrancas/REQ1/pdf");
  assert.equal(calls[0].method, "GET");
});

test("getBoletoPdfBase64 rejeita quando a resposta não traz o pdf", async () => {
  const request = async () => ({});
  await assert.rejects(getBoletoPdfBase64("REQ1", request), /PDF do boleto indisponível/);
});
