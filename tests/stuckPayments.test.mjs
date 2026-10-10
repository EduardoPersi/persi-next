import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STUCK_GIVE_UP_AGE_MS,
  STUCK_MAX_AGE_MS,
  STUCK_MIN_AGE_MS,
  isStuckCandidate,
  reconcileStuckOrder,
} from "../services/payments/stuckPayments.ts";
import { findCardChargeByReference as findPagBankCharge } from "../services/payments/pagbank/charge.ts";
import { resolveAttemptOutcome } from "../lib/commerce/paymentPolling.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const AGORA = Date.parse("2026-10-09T15:00:00Z");
const minutosAtras = (n) => new Date(AGORA - n * 60_000).toISOString();
const CHAVE = "6f1c1c1e-5a0b-4d1e-9a0b-5a0b4d1e9a0b";

function pedido(overrides = {}) {
  return {
    id: 1501,
    status: "pending",
    total: "199.90",
    currency: "BRL",
    paymentMethod: "mercadopago_card",
    billingEmail: "maria@example.com",
    billingName: "Maria Souza",
    billingPhone: "11987654321",
    metaData: { _persi_idempotency_key: CHAVE },
    createdAtGmt: minutosAtras(10),
    ...overrides,
  };
}

// Dependências de mentira: guardam o que foi chamado.
function montar({ estado = "PAYMENT_CREATING", mp = null, pb = null, pix = null, ref = null, erro } = {}) {
  const chamadas = { markPaid: [], markDeclined: [], markNotFound: [], attachReference: [], logs: [], leituras: [] };
  const deps = {
    getAttemptState: async () => estado,
    readers: {
      mercadopago: async (ref) => {
        chamadas.leituras.push(["mercadopago", ref]);
        if (erro) throw erro;
        return mp;
      },
      pagbank: async (ref) => {
        chamadas.leituras.push(["pagbank", ref]);
        if (erro) throw erro;
        return pb;
      },
      pix: async (txid) => {
        chamadas.leituras.push(["pix", txid]);
        if (erro) throw erro;
        return pix;
      },
      byReference: async (order, reference) => {
        chamadas.leituras.push(["byReference", order.paymentMethod, reference]);
        if (erro) throw erro;
        return ref;
      },
    },
    markPaid: async (order, provider, externalId) => chamadas.markPaid.push([order.id, provider, externalId]),
    markDeclined: async (order, provider, externalId) => chamadas.markDeclined.push([order.id, provider, externalId]),
    attachReference: async (order, provider, externalId) => chamadas.attachReference.push([order.id, provider, externalId]),
    markNotFound: async (order) => chamadas.markNotFound.push(order.id),
    now: () => AGORA,
    log: (entrada) => chamadas.logs.push(entrada),
  };
  return { deps, chamadas };
}

// ---------- quem entra ----------
test("candidatas: pendentes do checkout, sem cobrança guardada, com mais de 3 min e menos de 24 h", () => {
  assert.equal(STUCK_MIN_AGE_MS, 3 * 60_000);
  assert.equal(STUCK_GIVE_UP_AGE_MS, 30 * 60_000);
  assert.equal(STUCK_MAX_AGE_MS, 24 * 3600_000);
  assert.equal(isStuckCandidate(pedido({ createdAtGmt: minutosAtras(3.01) }), AGORA), true);
  assert.equal(isStuckCandidate(pedido({ createdAtGmt: minutosAtras(3) }), AGORA), false);
  assert.equal(isStuckCandidate(pedido({ createdAtGmt: minutosAtras(2) }), AGORA), false);
  assert.equal(isStuckCandidate(pedido({ createdAtGmt: minutosAtras(24 * 60 - 1) }), AGORA), true);
  assert.equal(isStuckCandidate(pedido({ createdAtGmt: minutosAtras(24 * 60) }), AGORA), false);
  // Já tem cobrança guardada, não é pendente, não é do checkout, sem data.
  assert.equal(isStuckCandidate(pedido({ metaData: { _persi_idempotency_key: CHAVE, _persi_payment_reference: "123" } }), AGORA), false);
  assert.equal(isStuckCandidate(pedido({ status: "processing" }), AGORA), false);
  assert.equal(isStuckCandidate(pedido({ metaData: {} }), AGORA), false);
  assert.equal(isStuckCandidate(pedido({ createdAtGmt: undefined }), AGORA), false);
});

// ---------- o que decide ----------
test("achou e aprovada: o pedido fica pago, pelo mesmo caminho do webhook", async () => {
  const { deps, chamadas } = montar({ mp: { externalId: "98765", evaluation: { category: "paid" } } });
  assert.equal(await reconcileStuckOrder(pedido(), deps), "paid");
  assert.deepEqual(chamadas.markPaid, [[1501, "mercadopago", "98765"]]);
  assert.deepEqual(chamadas.markDeclined, []);
  assert.deepEqual(chamadas.markNotFound, []);
  // Busca pelo número do pedido.
  assert.deepEqual(chamadas.leituras, [["mercadopago", "1501"]]);
});

test("achou e recusada: falha definitiva", async () => {
  const { deps, chamadas } = montar({ mp: { externalId: "98765", evaluation: { category: "failed" } } });
  assert.equal(await reconcileStuckOrder(pedido(), deps), "declined");
  assert.deepEqual(chamadas.markDeclined, [[1501, "mercadopago", "98765"]]);
  assert.deepEqual(chamadas.markPaid, []);
  assert.deepEqual(chamadas.markNotFound, []);
});

test("achou e ainda pendente: só guarda a referência para a varredura normal e os webhooks", async () => {
  const { deps, chamadas } = montar({ mp: { externalId: "98765", evaluation: { category: "pending" } } });
  assert.equal(await reconcileStuckOrder(pedido(), deps), "pending");
  assert.deepEqual(chamadas.attachReference, [[1501, "mercadopago", "98765"]]);
  assert.deepEqual(chamadas.markPaid, []);
  assert.deepEqual(chamadas.markDeclined, []);
  assert.deepEqual(chamadas.markNotFound, []);
});

test("não achou depois de 30 minutos: falha, e registra no log", async () => {
  const { deps, chamadas } = montar({ mp: null });
  const resultado = await reconcileStuckOrder(pedido({ createdAtGmt: minutosAtras(30) }), deps);
  assert.equal(resultado, "not_found_failed");
  assert.deepEqual(chamadas.markNotFound, [1501]);
  assert.deepEqual(chamadas.logs, [{ orderId: 1501, gateway: "mercadopago", band: "A", result: "not_found_failed" }]);
  assert.deepEqual(chamadas.markPaid, []);
});

test("não achou antes de 30 minutos: espera a próxima passada, sem mexer em nada", async () => {
  const { deps, chamadas } = montar({ mp: null });
  assert.equal(await reconcileStuckOrder(pedido({ createdAtGmt: minutosAtras(29) }), deps), "pending");
  assert.deepEqual(chamadas.markNotFound, []);
  assert.deepEqual(chamadas.markPaid, []);
  assert.deepEqual(chamadas.markDeclined, []);
});

test("cada gateway é consultado pela referência certa", async () => {
  const pb = montar({ pb: { externalId: "CHAR_1", evaluation: { category: "paid" } } });
  assert.equal(await reconcileStuckOrder(pedido({ paymentMethod: "pagbank_google_pay" }), pb.deps), "paid");
  assert.deepEqual(pb.chamadas.leituras, [["pagbank", "1501"]]);
  assert.deepEqual(pb.chamadas.markPaid, [[1501, "pagbank", "CHAR_1"]]);

  const pix = montar({ pix: { externalId: "6f1c1c1e5a0b4d1e9a0b5a0b4d1e9a0b", evaluation: { category: "paid" } } });
  assert.equal(await reconcileStuckOrder(pedido({ paymentMethod: "inter_pix" }), pix.deps), "paid");
  // O txid é a chave de idempotência sem os traços.
  assert.deepEqual(pix.chamadas.leituras, [["pix", "6f1c1c1e5a0b4d1e9a0b5a0b4d1e9a0b"]]);
  assert.deepEqual(pix.chamadas.markPaid, [[1501, "inter", "6f1c1c1e5a0b4d1e9a0b5a0b4d1e9a0b"]]);
});

test("só tentativas em PAYMENT_CREATING; boleto e erros não mudam nada", async () => {
  // Outro estado: não consulta o gateway nem grava.
  const outro = montar({ estado: "PAYMENT_CREATED", mp: { externalId: "1", evaluation: { category: "paid" } } });
  assert.equal(await reconcileStuckOrder(pedido(), outro.deps), "skipped");
  assert.deepEqual(outro.chamadas.leituras, []);
  // Tentativa que nunca existiu (sem estado).
  const semEstado = montar({ estado: null });
  assert.equal(await reconcileStuckOrder(pedido(), semEstado.deps), "skipped");
  // Boleto do Inter: sem leitura por número, nunca falha sozinho.
  const boleto = montar();
  assert.equal(await reconcileStuckOrder(pedido({ paymentMethod: "inter_boleto" }), boleto.deps), "skipped");
  assert.deepEqual(boleto.chamadas.leituras, []);
  assert.deepEqual(boleto.chamadas.markNotFound, []);
  // Erro na consulta: nada muda, mesmo depois de 30 minutos.
  const falha = montar({ erro: new Error("rede") });
  assert.equal(await reconcileStuckOrder(pedido({ createdAtGmt: minutosAtras(120) }), falha.deps), "error");
  assert.deepEqual(falha.chamadas.markNotFound, []);
  assert.deepEqual(falha.chamadas.markPaid, []);
});

test("o log só tem número do pedido, gateway e resultado: nada de dado pessoal", async () => {
  const { deps, chamadas } = montar({ mp: { externalId: "98765", evaluation: { category: "paid" } } });
  await reconcileStuckOrder(pedido(), deps);
  const texto = JSON.stringify(chamadas.logs);
  assert.deepEqual(Object.keys(chamadas.logs[0]).sort(), ["band", "gateway", "orderId", "result"]);
  for (const proibido of ["maria", "Maria", "987654321", "199.90", CHAVE]) {
    assert.ok(!texto.includes(proibido), `vazou no log: ${proibido}`);
  }
});

// ---------- leituras nos gateways ----------
test("PagBank: busca o pedido por reference_id (só leitura) e devolve a cobrança", async () => {
  const chamadas = [];
  const request = async (path, method) => {
    chamadas.push([path, method]);
    return { orders: [{ charges: [{ id: "CHAR_1", status: "PAID", amount: { value: 19990 } }] }] };
  };
  const cobranca = await findPagBankCharge("1501", request);
  assert.deepEqual(chamadas, [["/orders?reference_id=1501", "GET"]]);
  assert.equal(cobranca.chargeId, "CHAR_1");
  assert.equal(cobranca.status, "PAID");
  // Sem pedidos: null.
  assert.equal(await findPagBankCharge("1501", async () => ({ orders: [] })), null);
  assert.equal(await findPagBankCharge("1501", async () => ({})), null);
});

test("Mercado Pago: busca por external_reference com GET, sem corpo", () => {
  const fonte = read("services/payments/mercadopago/charge.ts");
  const inicio = fonte.indexOf("export async function findCardChargeByReference");
  const bloco = fonte.slice(inicio, fonte.indexOf("export async function getCardChargeStatus"));
  assert.ok(bloco.includes("/v1/payments/search?external_reference="));
  assert.ok(bloco.includes('"GET"'));
  assert.ok(!bloco.includes('"POST"'));
  assert.ok(bloco.includes("payment ? toChargeResult(payment) : null"));
});

// ---------- nunca cria, estorna nem repete cobrança ----------
test("os arquivos da rotina não têm nenhuma chamada de criação, estorno ou repetição de cobrança", () => {
  const arquivos = [
    "services/payments/stuckPayments.ts",
    "services/payments/chargeEvaluation.ts",
    "services/payments/cardReconcile.ts",
    "app/api/cron/reconcile-stuck-payments/route.ts",
  ];
  const proibidos = [
    "createCardCharge",
    "createPixCharge",
    "createBoletoCharge",
    "createPix(",
    "createBoleto(",
    "createPendingOrder",
    "interPaymentGateway",
    "refund",
    "estorn",
    "reembols",
    '"POST"',
    "method: \"POST\"",
    "transitionCheckoutAttempt",
    "reserveCheckoutAttempt",
  ];
  for (const arquivo of arquivos) {
    const fonte = read(arquivo).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const proibido of proibidos) {
      assert.ok(!fonte.includes(proibido), `${arquivo} não pode conter ${proibido}`);
    }
  }
  // As leituras novas dos gateways são GET.
  const pagbank = read("services/payments/pagbank/charge.ts");
  const bloco = pagbank.slice(pagbank.indexOf("export async function findCardChargeByReference"), pagbank.indexOf("export async function getCardChargeStatus"));
  assert.ok(bloco.includes('"GET"') && !bloco.includes('"POST"'));
});

test("a rota: mesma autenticação do outro cron, trava contra execução em paralelo e teste a seco", () => {
  const rota = read("app/api/cron/reconcile-stuck-payments/route.ts");
  assert.ok(rota.includes("isAuthorizedCronRequest(request.headers.get(\"authorization\"), process.env.CRON_SECRET)"));
  assert.ok(rota.includes("const overlapGuard = createOverlapGuard();"));
  assert.ok(rota.includes("overlapGuard.tryAcquire()"));
  assert.ok(rota.includes("overlapGuard.release()"));
  assert.ok(rota.includes('searchParams.get("dryRun") === "1"'));
  // No teste a seco nada é gravado.
  for (const escrita of ["markPaid", "markDeclined", "attachReference", "markNotFound"]) {
    const inicio = rota.indexOf(`${escrita}: async`);
    assert.ok(inicio > -1, `falta ${escrita}`);
    assert.ok(rota.slice(inicio, inicio + 120).includes("if (dryRun) return;"), `${escrita} sem trava de dryRun`);
  }
  // O aviso de pago e de falha vai pelo caminho do webhook (reconcilePaymentReference).
  assert.ok(rota.includes('reconcilePaymentReference(provider, externalId, "paid")'));
  assert.ok(rota.includes('reconcilePaymentReference(provider, externalId, "failed")'));
});

// ---------- o cliente que estava esperando ----------
test("pedido pago ou falho pela rotina libera o cliente que esperava, sem a cobrança guardada", () => {
  const tentativa = { state: "PAYMENT_CREATING", provider_reference: null, payment_method: "mercadopago_card" };
  assert.equal(resolveAttemptOutcome(tentativa, null), "processing");
  assert.equal(resolveAttemptOutcome(tentativa, null, "pending"), "processing");
  assert.equal(resolveAttemptOutcome(tentativa, null, "processing"), "created");
  assert.equal(resolveAttemptOutcome(tentativa, null, "completed"), "created");
  assert.equal(resolveAttemptOutcome(tentativa, null, "failed"), "declined");
  assert.equal(resolveAttemptOutcome(tentativa, null, "cancelled"), "declined");
  // Com a cobrança guardada, nada mudou.
  assert.equal(resolveAttemptOutcome({ ...tentativa, provider_reference: "123" }, false, "failed"), "created");
});
