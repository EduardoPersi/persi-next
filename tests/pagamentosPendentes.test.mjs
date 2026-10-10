import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { categorizeCardStatus, categorizeMercadoPagoCardStatus } from "../services/payments/reconcile.ts";
import { reconcileCardCharge } from "../services/payments/cardReconcile.ts";
import {
  evaluateBoletoCharge,
  evaluateCardCharge,
  evaluatePixCharge,
} from "../services/payments/chargeEvaluation.ts";
import { verifyApprovedCharge } from "../services/payments/approvedCharge.ts";
import { getPixChargeStatus } from "../services/payments/inter/pix.ts";
import { getBoletoChargeStatus } from "../services/payments/inter/boleto.ts";
import {
  HOURLY_WINDOW_MINUTES,
  PENDING_MAX_AGE_MS,
  isPendingCandidate,
  reconcilePendingOrder,
  reconcileStuckOrder,
} from "../services/payments/stuckPayments.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const PEDIDO = { total: "199.90", currency: "BRL" };
const CHAVE = "6f1c1c1e-5a0b-4d1e-9a0b-5a0b4d1e9a0b";
// 15:05 UTC: dentro da primeira janela de 10 minutos da hora.
const NA_HORA = Date.parse("2026-10-09T15:05:00Z");
const FORA_DA_HORA = Date.parse("2026-10-09T15:35:00Z");
const atras = (nowMs, ms) => new Date(nowMs - ms).toISOString();
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

function pedido(overrides = {}) {
  return {
    id: 1601,
    status: "pending",
    total: "199.90",
    currency: "BRL",
    paymentMethod: "inter_pix",
    billingEmail: "maria@example.com",
    billingName: "Maria Souza",
    billingPhone: "11987654321",
    metaData: { _persi_payment_reference: "TX1601" },
    createdAtGmt: atras(NA_HORA, 2 * HORA),
    ...overrides,
  };
}

// ---------- regra estrita no site inteiro ----------
test("só approved / PAID contam como pago; authorized / AUTHORIZED ficam pendentes", () => {
  assert.equal(categorizeMercadoPagoCardStatus("approved"), "paid");
  assert.equal(categorizeMercadoPagoCardStatus("authorized"), "pending");
  assert.equal(categorizeMercadoPagoCardStatus("in_process"), "pending");
  assert.equal(categorizeMercadoPagoCardStatus("rejected"), "failed");
  assert.equal(categorizeCardStatus("PAID"), "paid");
  assert.equal(categorizeCardStatus("AUTHORIZED"), "pending");
  assert.equal(categorizeCardStatus("DECLINED"), "failed");
});

test("webhooks, rota de status e cron de pendentes passam pela conferência (reconcileCardCharge)", () => {
  const webhookMp = read("app/api/webhooks/mercadopago/route.ts");
  const webhookPb = read("app/api/webhooks/pagbank/route.ts");
  const status = read("app/api/checkout/payment/status/route.ts");
  const cron = read("app/api/cron/expire-pending-payments/route.ts");
  assert.equal(webhookMp.split('reconcileCardCharge("mercadopago", paymentId, charge)').length - 1, 2);
  assert.ok(webhookPb.includes('reconcileCardCharge("pagbank", chargeId, charge)'));
  assert.ok(status.includes('reconcileCardCharge("mercadopago", reference, charge)'));
  assert.ok(cron.includes('reconcileCardCharge("mercadopago", reference, charge)'));
  assert.ok(cron.includes('reconcileCardCharge("pagbank", reference, charge)'));
  // Nenhum deles categoriza cartão sozinho (sem conferir valor/moeda).
  for (const fonte of [webhookMp, webhookPb, status, cron]) {
    assert.ok(!fonte.includes("categorizeCardStatus("));
    assert.ok(!fonte.includes("categorizeMercadoPagoCardStatus("));
  }
});

function depsDeCartao({ order = { id: 7, total: "199.90", currency: "BRL" } } = {}) {
  const chamadas = { reconcile: [], logs: [], buscas: 0 };
  return {
    chamadas,
    deps: {
      findOrder: async () => {
        chamadas.buscas += 1;
        return order;
      },
      reconcile: async (provider, id, categoria) => chamadas.reconcile.push([provider, id, categoria]),
      log: (mensagem, detalhes) => chamadas.logs.push([mensagem, detalhes]),
    },
  };
}

test("cartão aprovado com valor e moeda certos: marca pago", async () => {
  const { deps, chamadas } = depsDeCartao();
  const categoria = await reconcileCardCharge("mercadopago", "98765", { status: "approved", amount: 199.9, currency: "BRL" }, deps);
  assert.equal(categoria, "paid");
  assert.deepEqual(chamadas.reconcile, [["mercadopago", "98765", "paid"]]);
  assert.deepEqual(chamadas.logs, []);
});

test("cartão authorized (sem captura) NÃO marca pago, nem consulta o pedido", async () => {
  const { deps, chamadas } = depsDeCartao();
  const categoria = await reconcileCardCharge("mercadopago", "98765", { status: "authorized", amount: 199.9, currency: "BRL" }, deps);
  assert.equal(categoria, "pending");
  assert.deepEqual(chamadas.reconcile, [["mercadopago", "98765", "pending"]]);
  const pb = depsDeCartao();
  assert.equal(await reconcileCardCharge("pagbank", "CHAR_1", { status: "AUTHORIZED", amount: 199.9, currency: "BRL" }, pb.deps), "pending");
  assert.ok(!pb.chamadas.reconcile.some(([, , c]) => c === "paid"));
});

test("cartão aprovado com valor ou moeda diferentes: não marca pago, vira pendente e registra o motivo", async () => {
  const valor = depsDeCartao();
  assert.equal(await reconcileCardCharge("pagbank", "CHAR_1", { status: "PAID", amount: 150, currency: "BRL" }, valor.deps), "pending");
  assert.deepEqual(valor.chamadas.reconcile, []);
  assert.deepEqual(valor.chamadas.logs[0][1], { orderId: 7, provider: "pagbank", reason: "amount_mismatch" });

  const moeda = depsDeCartao();
  assert.equal(await reconcileCardCharge("mercadopago", "1", { status: "approved", amount: 199.9, currency: "USD" }, moeda.deps), "pending");
  assert.deepEqual(moeda.chamadas.reconcile, []);
  assert.equal(moeda.chamadas.logs[0][1].reason, "currency_mismatch");
});

test("sem moeda no gateway: assume BRL, marca pago e registra currency_assumed_brl", async () => {
  const { deps, chamadas } = depsDeCartao();
  assert.equal(await reconcileCardCharge("mercadopago", "1", { status: "approved", amount: 199.9 }, deps), "paid");
  assert.deepEqual(chamadas.reconcile, [["mercadopago", "1", "paid"]]);
  assert.equal(chamadas.logs[0][1].reason, "currency_assumed_brl");
});

test("recusado vai direto para falho (sem conferir valor); pedido não encontrado não marca nada", async () => {
  const recusa = depsDeCartao();
  assert.equal(await reconcileCardCharge("mercadopago", "1", { status: "rejected", amount: 0 }, recusa.deps), "failed");
  assert.deepEqual(recusa.chamadas.reconcile, [["mercadopago", "1", "failed"]]);
  assert.equal(recusa.chamadas.buscas, 0);

  const semPedido = { findOrder: async () => null, reconcile: async () => assert.fail("não deveria reconciliar"), log: () => {} };
  assert.equal(await reconcileCardCharge("mercadopago", "1", { status: "approved", amount: 199.9, currency: "BRL" }, semPedido), "paid");
});

// ---------- Inter: valor.original (Pix) e valorNominal (boleto) ----------
test("Pix: lê valor.original; sem o campo, o valor fica ausente", async () => {
  const comValor = await getPixChargeStatus("TX1", async () => ({
    txid: "TX1",
    status: "CONCLUIDA",
    valor: { original: "199.90" },
    calendario: { criacao: "2026-10-09T10:00:00Z", expiracao: 3600 },
  }));
  assert.equal(comValor.amount, 199.9);
  const semValor = await getPixChargeStatus("TX1", async () => ({
    txid: "TX1",
    status: "CONCLUIDA",
    calendario: { criacao: "2026-10-09T10:00:00Z", expiracao: 3600 },
  }));
  assert.ok(!("amount" in semValor));
  const ilegivel = await getPixChargeStatus("TX1", async () => ({
    txid: "TX1",
    status: "CONCLUIDA",
    valor: { original: "abc" },
    calendario: { criacao: "2026-10-09T10:00:00Z", expiracao: 3600 },
  }));
  assert.ok(!("amount" in ilegivel));
});

test("boleto: lê valorNominal; sem o campo, o valor fica ausente", async () => {
  const comValor = await getBoletoChargeStatus("B1", async () => ({
    cobranca: { situacao: "MARCADO_RECEBIDO", dataVencimento: "2026-10-11", valorNominal: 199.9 },
    boleto: { linhaDigitavel: "123", codigoBarras: "456" },
  }));
  assert.equal(comValor.amount, 199.9);
  const emTexto = await getBoletoChargeStatus("B1", async () => ({ cobranca: { situacao: "A_RECEBER", valorNominal: "199.90" } }));
  assert.equal(emTexto.amount, 199.9);
  const semValor = await getBoletoChargeStatus("B1", async () => ({ cobranca: { situacao: "MARCADO_RECEBIDO" } }));
  assert.ok(!("amount" in semValor));
});

test("Pix pago: valor igual marca pago; valor diferente ou ausente NÃO marca; expirado e removido só encerram", () => {
  const futuro = new Date(NA_HORA + HORA).toISOString();
  const passado = new Date(NA_HORA - HORA).toISOString();
  assert.deepEqual(evaluatePixCharge({ status: "CONCLUIDA", expiresAt: passado, amount: 199.9 }, PEDIDO, NA_HORA), { category: "paid" });
  assert.deepEqual(evaluatePixCharge({ status: "CONCLUIDA", expiresAt: passado, amount: 10 }, PEDIDO, NA_HORA), { category: "unverified", reason: "amount_mismatch" });
  assert.deepEqual(evaluatePixCharge({ status: "CONCLUIDA", expiresAt: passado }, PEDIDO, NA_HORA), { category: "unverified", reason: "invalid_amount" });
  assert.deepEqual(evaluatePixCharge({ status: "ATIVA", expiresAt: futuro }, PEDIDO, NA_HORA), { category: "pending" });
  assert.deepEqual(evaluatePixCharge({ status: "ATIVA", expiresAt: passado }, PEDIDO, NA_HORA), { category: "closed" });
  assert.deepEqual(evaluatePixCharge({ status: "REMOVIDA_PELO_PSP", expiresAt: futuro }, PEDIDO, NA_HORA), { category: "closed" });
  // Pedido que não é em reais nunca marca pago.
  assert.equal(evaluatePixCharge({ status: "CONCLUIDA", expiresAt: passado, amount: 199.9 }, { total: "199.90", currency: "USD" }, NA_HORA).category, "unverified");
});

test("boleto pago: valorNominal igual marca pago; ausente ou diferente NÃO marca; vencido e cancelado só encerram", () => {
  assert.deepEqual(evaluateBoletoCharge({ status: "MARCADO_RECEBIDO", amount: 199.9 }, PEDIDO), { category: "paid" });
  assert.deepEqual(evaluateBoletoCharge({ status: "MARCADO_RECEBIDO" }, PEDIDO), { category: "unverified", reason: "invalid_amount" });
  assert.deepEqual(evaluateBoletoCharge({ status: "MARCADO_RECEBIDO", amount: 199 }, PEDIDO), { category: "unverified", reason: "amount_mismatch" });
  for (const status of ["ATRASADO", "CANCELADO", "EXPIRADO", "FALHA_EMISSAO"]) {
    assert.deepEqual(evaluateBoletoCharge({ status }, PEDIDO), { category: "closed" });
  }
  assert.deepEqual(evaluateBoletoCharge({ status: "A_RECEBER" }, PEDIDO), { category: "pending" });
  assert.deepEqual(evaluateBoletoCharge({ status: "EM_PROCESSAMENTO" }, PEDIDO), { category: "pending" });
});

test("a conferência do Inter usa a mesma verifyApprovedCharge, com BRL fixo", () => {
  assert.equal(verifyApprovedCharge("inter_pix", { status: "CONCLUIDA", amount: 199.9, currency: "BRL" }, PEDIDO).approved, true);
  assert.equal(verifyApprovedCharge("inter_pix", { status: "ATIVA", amount: 199.9, currency: "BRL" }, PEDIDO).approved, false);
  assert.equal(verifyApprovedCharge("inter_boleto", { status: "MARCADO_RECEBIDO", amount: 199.9, currency: "BRL" }, PEDIDO).approved, true);
  assert.equal(verifyApprovedCharge("inter_boleto", { status: "A_RECEBER", amount: 199.9, currency: "BRL" }, PEDIDO).approved, false);
  assert.equal(evaluateCardCharge("mercadopago", { status: "approved", amount: 199.9, currency: "BRL" }, PEDIDO).category, "paid");
});

// ---------- faixa B: quem entra e quando ----------
test("faixa B: pendentes COM cobrança, de 3 min a 5 dias", () => {
  assert.equal(PENDING_MAX_AGE_MS, 5 * DIA);
  assert.equal(isPendingCandidate(pedido(), NA_HORA), true);
  assert.equal(isPendingCandidate(pedido({ createdAtGmt: atras(NA_HORA, 3 * MIN) }), NA_HORA), false);
  assert.equal(isPendingCandidate(pedido({ createdAtGmt: atras(NA_HORA, 3 * MIN + 1000) }), NA_HORA), true);
  assert.equal(isPendingCandidate(pedido({ createdAtGmt: atras(NA_HORA, 5 * DIA - MIN) }), NA_HORA), true);
  assert.equal(isPendingCandidate(pedido({ createdAtGmt: atras(NA_HORA, 5 * DIA) }), NA_HORA), false);
  assert.equal(isPendingCandidate(pedido({ metaData: {} }), NA_HORA), false);
  assert.equal(isPendingCandidate(pedido({ status: "processing" }), NA_HORA), false);
  assert.equal(isPendingCandidate(pedido({ paymentMethod: "bacs" }), NA_HORA), false);
  assert.equal(isPendingCandidate(pedido({ createdAtGmt: undefined }), NA_HORA), false);
  for (const metodo of ["mercadopago_card", "pagbank_apple_pay", "pagbank_google_pay", "inter_pix", "inter_boleto"]) {
    assert.equal(isPendingCandidate(pedido({ paymentMethod: metodo }), NA_HORA), true, metodo);
  }
});

test("cadência: até 24 h em toda passada; de 1 a 5 dias, só na primeira passada de cada hora", () => {
  assert.equal(HOURLY_WINDOW_MINUTES, 10);
  const novo = (agora) => pedido({ createdAtGmt: atras(agora, 23 * HORA) });
  const antigo = (agora) => pedido({ createdAtGmt: atras(agora, 2 * DIA) });
  // De 10 em 10 minutos, o pedido de 23 h entra sempre.
  for (const minuto of [0, 10, 20, 30, 40, 50]) {
    const agora = Date.parse(`2026-10-09T15:${String(minuto).padStart(2, "0")}:30Z`);
    assert.equal(isPendingCandidate(novo(agora), agora), true, `23h no minuto ${minuto}`);
  }
  // O de 2 dias entra 1 vez por hora (minutos 00 a 09).
  let entradas = 0;
  for (const minuto of [0, 10, 20, 30, 40, 50]) {
    const agora = Date.parse(`2026-10-09T15:${String(minuto).padStart(2, "0")}:30Z`);
    if (isPendingCandidate(antigo(agora), agora)) entradas += 1;
  }
  assert.equal(entradas, 1);
  assert.equal(isPendingCandidate(antigo(NA_HORA), NA_HORA), true);
  assert.equal(isPendingCandidate(antigo(FORA_DA_HORA), FORA_DA_HORA), false);
  // `?all=1` ignora a cadência por hora (útil no teste), mas não o limite de 5 dias.
  assert.equal(isPendingCandidate(antigo(FORA_DA_HORA), FORA_DA_HORA, true), true);
  assert.equal(isPendingCandidate(pedido({ createdAtGmt: atras(FORA_DA_HORA, 6 * DIA) }), FORA_DA_HORA, true), false);
});

// ---------- faixa B: o que decide ----------
function montar({ ref = null, pix = null, erro } = {}) {
  const chamadas = { markPaid: [], markDeclined: [], markNotFound: [], attachReference: [], logs: [], leituras: [] };
  const deps = {
    getAttemptState: async () => "PAYMENT_CREATING",
    readers: {
      mercadopago: async () => null,
      pagbank: async () => null,
      pix: async () => pix,
      byReference: async (order, reference) => {
        chamadas.leituras.push([order.paymentMethod, reference]);
        if (erro) throw erro;
        return ref;
      },
    },
    markPaid: async (order, provider, externalId) => chamadas.markPaid.push([order.id, provider, externalId]),
    markDeclined: async (order, provider, externalId) => chamadas.markDeclined.push([order.id, provider, externalId]),
    attachReference: async (order, provider, externalId) => chamadas.attachReference.push([order.id, provider, externalId]),
    markNotFound: async (order) => chamadas.markNotFound.push(order.id),
    now: () => NA_HORA,
    log: (entrada) => chamadas.logs.push(entrada),
  };
  return { deps, chamadas };
}

test("faixa B: gateway diz pago e confere → marca pago pelo mesmo caminho", async () => {
  const { deps, chamadas } = montar({ ref: { externalId: "TX1601", evaluation: { category: "paid" } } });
  assert.equal(await reconcilePendingOrder(pedido(), deps), "paid");
  assert.deepEqual(chamadas.markPaid, [[1601, "inter", "TX1601"]]);
  assert.deepEqual(chamadas.leituras, [["inter_pix", "TX1601"]]);
  assert.deepEqual(chamadas.logs, [{ orderId: 1601, gateway: "inter", band: "B", result: "paid" }]);
});

test("faixa B: moeda assumida BRL é registrada no log, sem dado pessoal", async () => {
  const { deps, chamadas } = montar({ ref: { externalId: "99", evaluation: { category: "paid", currencyAssumed: true } } });
  assert.equal(await reconcilePendingOrder(pedido({ paymentMethod: "mercadopago_card", metaData: { _persi_payment_reference: "99" } }), deps), "paid");
  assert.equal(chamadas.logs[0].reason, "currency_assumed_brl");
  assert.deepEqual(chamadas.markPaid, [[1601, "mercadopago", "99"]]);
});

test("faixa B: valor, moeda ou campo que não conferem → NÃO marca pago, só registra o motivo", async () => {
  const { deps, chamadas } = montar({ ref: { externalId: "TX1601", evaluation: { category: "unverified", reason: "invalid_amount" } } });
  assert.equal(await reconcilePendingOrder(pedido(), deps), "unverified");
  assert.deepEqual(chamadas.markPaid, []);
  assert.deepEqual(chamadas.attachReference, []);
  assert.equal(chamadas.logs[0].reason, "invalid_amount");
});

test("faixa B: Pix expirado, boleto vencido, cartão recusado → só log, nada é cancelado nem gravado", async () => {
  for (const [metodo, categoria] of [["inter_pix", "closed"], ["inter_boleto", "closed"], ["mercadopago_card", "failed"], ["pagbank_google_pay", "failed"]]) {
    const { deps, chamadas } = montar({ ref: { externalId: "X", evaluation: { category: categoria } } });
    assert.equal(await reconcilePendingOrder(pedido({ paymentMethod: metodo }), deps), "closed", metodo);
    assert.deepEqual(chamadas.markPaid, []);
    assert.deepEqual(chamadas.markDeclined, []);
    assert.deepEqual(chamadas.markNotFound, []);
    assert.deepEqual(chamadas.attachReference, []);
  }
});

test("faixa B: ainda pendente, cobrança inexistente e erro de consulta não mudam nada", async () => {
  const pendente = montar({ ref: { externalId: "X", evaluation: { category: "pending" } } });
  assert.equal(await reconcilePendingOrder(pedido(), pendente.deps), "pending");
  const inexistente = montar({ ref: null });
  assert.equal(await reconcilePendingOrder(pedido(), inexistente.deps), "pending");
  const erro = montar({ erro: new Error("rede") });
  assert.equal(await reconcilePendingOrder(pedido(), erro.deps), "error");
  for (const { chamadas } of [pendente, inexistente, erro]) {
    assert.deepEqual(chamadas.markPaid, []);
    assert.deepEqual(chamadas.markDeclined, []);
    assert.deepEqual(chamadas.markNotFound, []);
    assert.deepEqual(chamadas.attachReference, []);
  }
});

// ---------- faixa A com a conferência ----------
function pedidoTravado(overrides = {}) {
  return pedido({
    metaData: { _persi_idempotency_key: CHAVE },
    createdAtGmt: atras(NA_HORA, 10 * MIN),
    ...overrides,
  });
}

test("faixa A: Pix expirado guarda a referência e só registra (não cancela); pago sem conferir não marca", async () => {
  const expirado = montar({ pix: { externalId: "TXA", evaluation: { category: "closed" } } });
  assert.equal(await reconcileStuckOrder(pedidoTravado(), expirado.deps), "closed");
  assert.deepEqual(expirado.chamadas.attachReference, [[1601, "inter", "TXA"]]);
  assert.deepEqual(expirado.chamadas.markDeclined, []);
  assert.deepEqual(expirado.chamadas.markNotFound, []);

  const semConferir = montar({ pix: { externalId: "TXA", evaluation: { category: "unverified", reason: "amount_mismatch" } } });
  assert.equal(await reconcileStuckOrder(pedidoTravado(), semConferir.deps), "unverified");
  assert.deepEqual(semConferir.chamadas.markPaid, []);
  assert.equal(semConferir.chamadas.logs[0].reason, "amount_mismatch");
});

// ---------- a rota ----------
test("a rota: duas faixas, trava contra paralelo, dry-run sem gravar e nenhuma criação/estorno/cancelamento de Pix ou boleto", () => {
  const rota = read("app/api/cron/reconcile-stuck-payments/route.ts");
  assert.ok(rota.includes("findPendingOrdersWithPaymentReferenceSince"));
  assert.ok(rota.includes("findPendingOrdersWithoutPaymentReference"));
  assert.ok(rota.includes("reconcilePendingOrder(order, deps)"));
  assert.ok(rota.includes("const overlapGuard = createOverlapGuard();"));
  assert.ok(rota.includes('searchParams.get("all") === "1"'));
  // O Inter é lido pelas mesmas funções de consulta (GET).
  assert.ok(rota.includes("getBoletoChargeStatus(reference)") && rota.includes("getPixChargeStatus(txid)"));
  // Gravar dentro do dry-run é proibido.
  for (const escrita of ["markPaid", "markDeclined", "attachReference", "markNotFound"]) {
    const inicio = rota.indexOf(`${escrita}: async`);
    assert.ok(rota.slice(inicio, inicio + 120).includes("if (dryRun) return;"), escrita);
  }
  // A faixa B nunca falha pedido: o módulo só chama markPaid nela.
  const modulo = read("services/payments/stuckPayments.ts");
  const faixaB = modulo.slice(modulo.indexOf("export async function reconcilePendingOrder"));
  assert.ok(!faixaB.includes("markDeclined") && !faixaB.includes("markNotFound") && !faixaB.includes("attachReference"));
  // Log sem dado pessoal.
  assert.ok(!/billingEmail|billingName|billingPhone|metaData\[.*document/i.test(modulo.replace(/\/\*[\s\S]*?\*\//g, "")));
});
