import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isApprovedStatus, verifyApprovedCharge } from "../services/payments/approvedCharge.ts";
import { getCardChargeStatus as getPagBankCharge } from "../services/payments/pagbank/charge.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const PEDIDO = { total: "199.90", currency: "BRL" };
const cobranca = (overrides = {}) => ({ status: "approved", amount: 199.9, currency: "BRL", ...overrides });

// ---------- status ----------
test("Mercado Pago: só `approved` vale; authorized, in_process, pending e o resto não", () => {
  assert.equal(isApprovedStatus("mercadopago", "approved"), true);
  for (const status of ["authorized", "in_process", "pending", "rejected", "cancelled", "refunded", "charged_back", "", "APPROVED"]) {
    assert.equal(isApprovedStatus("mercadopago", status), false, status);
    assert.equal(verifyApprovedCharge("mercadopago", cobranca({ status }), PEDIDO).approved, false, status);
  }
});

test("PagBank: só `PAID` vale; AUTHORIZED e IN_ANALYSIS não", () => {
  assert.equal(isApprovedStatus("pagbank", "PAID"), true);
  for (const status of ["AUTHORIZED", "IN_ANALYSIS", "DECLINED", "CANCELED", "paid"]) {
    assert.equal(isApprovedStatus("pagbank", status), false, status);
  }
  assert.deepEqual(verifyApprovedCharge("pagbank", { status: "PAID", amount: 199.9, currency: "BRL" }, PEDIDO), { approved: true });
  assert.equal(verifyApprovedCharge("pagbank", { status: "AUTHORIZED", amount: 199.9, currency: "BRL" }, PEDIDO).approved, false);
});

// ---------- valor ----------
test("o valor pago tem de ser igual ao total do pedido, ao centavo", () => {
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca(), PEDIDO), { approved: true });
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ amount: 199.9 }), { total: "199.9", currency: "BRL" }), { approved: true });
  // Menor, maior e por um centavo: nenhum vale.
  for (const amount of [199.89, 199.91, 0.01, 19990, 99.95]) {
    assert.deepEqual(
      verifyApprovedCharge("mercadopago", cobranca({ amount }), PEDIDO),
      { approved: false, reason: "amount_mismatch" },
      String(amount),
    );
  }
  // Erro de ponto flutuante (0.1 + 0.2) não derruba um valor igual.
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ amount: 0.1 + 0.2 }), { total: "0.30", currency: "BRL" }), { approved: true });
  // Valores inválidos nunca marcam pago.
  assert.equal(verifyApprovedCharge("mercadopago", cobranca({ amount: Number.NaN }), PEDIDO).reason, "invalid_amount");
  assert.equal(verifyApprovedCharge("mercadopago", cobranca(), { total: "abc", currency: "BRL" }).reason, "invalid_amount");
  assert.equal(verifyApprovedCharge("mercadopago", cobranca({ amount: 0 }), { total: "0.00", currency: "BRL" }).reason, "invalid_amount");
});

// ---------- moeda ----------
test("moeda: a loja só vende em BRL; sem moeda informada assume BRL e avisa; outra moeda não marca pago", () => {
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ currency: "brl" }), PEDIDO), { approved: true });
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ currency: "USD" }), PEDIDO), { approved: false, reason: "currency_mismatch" });
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ currency: "ARS" }), PEDIDO), { approved: false, reason: "currency_mismatch" });
  // O gateway não devolveu a moeda: assume BRL e marca para o log (`currency_assumed_brl`).
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ currency: undefined }), PEDIDO), { approved: true, currencyAssumed: true });
  assert.deepEqual(verifyApprovedCharge("pagbank", { status: "PAID", amount: 199.9 }, PEDIDO), { approved: true, currencyAssumed: true });
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobranca({ currency: "  " }), PEDIDO), { approved: true, currencyAssumed: true });
  // Status e valor continuam obrigatórios mesmo sem moeda.
  assert.equal(verifyApprovedCharge("mercadopago", cobranca({ currency: undefined, status: "authorized" }), PEDIDO).approved, false);
  assert.equal(verifyApprovedCharge("mercadopago", cobranca({ currency: undefined, amount: 150 }), PEDIDO).approved, false);
  // Pedido que não é em BRL nunca foi vendido por esta loja.
  assert.equal(verifyApprovedCharge("mercadopago", cobranca(), { total: "199.90", currency: "USD" }).approved, false);
});

// ---------- parcelado com juros ----------
test("cartão parcelado com juros: vale o valor da COMPRA (transaction_amount), não o total pago com juros", () => {
  // Pedido de R$ 199,90 em 6x com juros: o cliente paga R$ 214,30 no total, mas a compra é de R$ 199,90.
  const respostaMercadoPago = { status: "approved", transaction_amount: 199.9, currency_id: "BRL", installments: 6, transaction_details: { total_paid_amount: 214.3 } };
  // O mapeamento do site lê transaction_amount, nunca o total pago.
  const cobrancaMapeada = { status: respostaMercadoPago.status, amount: respostaMercadoPago.transaction_amount, currency: respostaMercadoPago.currency_id };
  assert.deepEqual(verifyApprovedCharge("mercadopago", cobrancaMapeada, PEDIDO), { approved: true });
  // Se alguém comparasse com o total pago com juros, o pedido legítimo seria recusado.
  assert.equal(verifyApprovedCharge("mercadopago", { ...cobrancaMapeada, amount: respostaMercadoPago.transaction_details.total_paid_amount }, PEDIDO).approved, false);
  const fonte = read("services/payments/mercadopago/charge.ts");
  assert.ok(fonte.includes("amount: payment.transaction_amount,"));
  assert.ok(!fonte.includes("total_paid_amount") && !fonte.includes("transaction_details"));
});

test("PagBank parcelado com juros: vale amount.value (a cobrança sem taxas e juros), em centavos", async () => {
  const resposta = { id: "CHAR_9", status: "PAID", amount: { value: 19990, currency: "BRL", summary: { total: 21430, paid: 21430, fees: 1440 } }, payment_method: { installments: 6 } };
  const lida = await getPagBankCharge("CHAR_9", async () => resposta);
  assert.equal(lida.amount, 199.9);
  assert.deepEqual(verifyApprovedCharge("pagbank", lida, PEDIDO), { approved: true });
  const fonte = read("services/payments/pagbank/charge.ts");
  assert.ok(fonte.includes("amount: charge.amount.value / 100,"));
  assert.ok(!fonte.includes("summary"));
});

// ---------- a leitura traz a moeda ----------
test("PagBank: a leitura da cobrança traz a moeda e o valor em reais", async () => {
  const resposta = { id: "CHAR_1", status: "PAID", amount: { value: 19990, currency: "BRL" } };
  const lida = await getPagBankCharge("CHAR_1", async () => resposta);
  assert.equal(lida.amount, 199.9);
  assert.equal(lida.currency, "BRL");
});

test("Mercado Pago: a leitura traz a moeda (currency_id)", () => {
  const fonte = read("services/payments/mercadopago/charge.ts");
  assert.ok(fonte.includes("currency_id?: string;"));
  assert.ok(fonte.includes("currency: payment.currency_id,"));
});

// ---------- a rota e a página ----------
test("rota: consulta de novo pelo id e só marca pago depois de status, valor e moeda conferirem", () => {
  const route = read("app/api/checkout/payment/route.ts");
  const inicio = route.indexOf("async function reconcileApprovedCard(");
  const funcao = route.slice(inicio, route.indexOf("function requireCompleteAddress(", inicio));
  // 1. Nova consulta ao gateway pelo id da cobrança.
  assert.ok(funcao.includes("await getMercadoPagoCardChargeStatus(chargeId)"));
  assert.ok(funcao.includes("await getPagBankCardChargeStatus(chargeId)"));
  // 2 e 3. Confere antes de marcar; só marca se aprovado.
  const consulta = funcao.indexOf("const fresh =");
  const confere = funcao.indexOf("verifyApprovedCharge(provider, fresh, order)");
  const marca = funcao.indexOf('await reconcilePaymentReference(provider, chargeId, "paid");');
  assert.ok(consulta > -1 && confere > consulta && marca > confere);
  assert.ok(funcao.includes("if (!check.approved) {"));
  // O motivo vai para o log sem dado pessoal: número do pedido, gateway e motivo.
  assert.ok(funcao.includes("orderId: order.id,"));
  assert.ok(!/email|phone|telefone|document|total|amount/i.test(funcao.slice(funcao.indexOf("console.warn"), funcao.indexOf("return;"))));
  // Moeda não informada: assume BRL e registra o aviso.
  assert.ok(funcao.includes("if (check.currencyAssumed) {"));
  assert.ok(funcao.includes('note: "currency_assumed_brl"'));
  // A função recebe o pedido nos dois ramos de cartão.
  assert.ok(route.includes('await reconcileApprovedCard("mercadopago", charge.chargeId, order);'));
  assert.ok(route.includes('await reconcileApprovedCard("pagbank", charge.chargeId, order);'));
});

test("página de confirmação: só reconcilia o aprovado depois da mesma conferência", () => {
  const page = read("app/checkout/confirmacao/page.tsx");
  assert.equal(page.split("verifyApprovedCharge(").length - 1, 3);
  assert.ok(page.includes('verifyApprovedCharge("mercadopago", charge, order).approved'));
  assert.ok(page.includes('verifyApprovedCharge("pagbank", charge, order).approved'));
  // A categoria que decide a TELA não mudou, só o que grava no pedido.
  assert.ok(!page.includes('category === "failed" || category === "paid"'));
});
