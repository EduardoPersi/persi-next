import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_TIMEOUT_MS,
  PAYMENT_PROCESSING_MESSAGE,
  PAYMENT_TIMEOUT_MESSAGE,
  isPaymentInProgress,
  pollPaymentAttempt,
  resolveAttemptOutcome,
} from "../lib/commerce/paymentPolling.ts";
import { nextIdempotencyKey } from "../lib/commerce/paymentRetry.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// Relógio de mentira: `wait` avança o tempo, sem esperar de verdade.
function relogio() {
  let agora = 0;
  return {
    now: () => agora,
    wait: async (ms) => {
      agora += ms;
    },
    get decorrido() {
      return agora;
    },
  };
}

let sequencia = 0;
const gerar = () => `chave-nova-${++sequencia}`;

test("as mensagens e os tempos são os aprovados", () => {
  assert.equal(PAYMENT_POLL_INTERVAL_MS, 5_000);
  assert.equal(PAYMENT_POLL_TIMEOUT_MS, 120_000);
  assert.equal(PAYMENT_PROCESSING_MESSAGE, "Estamos confirmando seu pagamento com o banco. Não feche esta página.");
  assert.equal(
    PAYMENT_TIMEOUT_MESSAGE,
    "Ainda não recebemos a confirmação do banco. Você receberá a confirmação por e-mail. Se preferir, fale com a gente no WhatsApp.",
  );
});

test("só os dois 409 de 'processando' entram na espera", () => {
  assert.equal(isPaymentInProgress({ status: 409, code: "PAYMENT_IN_PROGRESS" }), true);
  assert.equal(isPaymentInProgress({ status: 409, code: "CHECKOUT_IN_PROGRESS" }), true);
  for (const outro of [
    { status: 409, code: "ORDER_TOTAL_MISMATCH" },
    { status: 409, code: "CART_CHANGED" },
    { status: 402, code: "CARD_PAYMENT_DECLINED" },
    { status: 429, code: "RATE_LIMITED" },
    { status: 500, code: "PAYMENT_IN_PROGRESS" },
    {},
  ]) {
    assert.equal(isPaymentInProgress(outro), false, JSON.stringify(outro));
  }
});

test("resultado da tentativa: cobrança guardada, recusa, confirmação e ainda sem nada", () => {
  const tentativa = (state, provider_reference = null, payment_method = "mercadopago_card") => ({
    state,
    provider_reference,
    payment_method,
  });
  // Sem cobrança guardada: continua esperando (nada de decidir às cegas).
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CREATING"), null), "processing");
  assert.equal(resolveAttemptOutcome(tentativa("ORDER_CREATED"), null), "processing");
  // Estados finais.
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_FAILED", "mp_1"), null), "declined");
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CONFIRMED", "mp_1"), null), "created");
  // Cobrança de cartão guardada: depende do que o gateway diz (só leitura).
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CREATED", "mp_1"), true), "declined");
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CREATED", "mp_1"), false), "created");
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CREATED", "mp_1"), null), "processing");
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CREATED", "pb_1", "pagbank_google_pay"), true), "declined");
  // Boleto e Pix com cobrança guardada: a página do pedido mostra o resto.
  assert.equal(resolveAttemptOutcome(tentativa("PAYMENT_CREATED", "REQ", "inter_boleto"), null), "created");
});

test("409 → consulta → aprovado: segue para a página do pedido, com a MESMA chave", async () => {
  const tempo = relogio();
  const chaveUsada = "chave-do-409";
  const consultas = [];
  const respostas = [
    { outcome: "processing" },
    { outcome: "processing" },
    { outcome: "created", confirmationUrl: `/checkout/confirmacao?attempt=${chaveUsada}` },
  ];
  const resultado = await pollPaymentAttempt({
    check: async () => {
      consultas.push(chaveUsada);
      return respostas[consultas.length - 1];
    },
    wait: tempo.wait,
    now: tempo.now,
  });
  assert.deepEqual(resultado, { kind: "created", confirmationUrl: `/checkout/confirmacao?attempt=${chaveUsada}` });
  assert.equal(consultas.length, 3);
  assert.ok(consultas.every((chave) => chave === chaveUsada));
  // Consultou a cada 5 s: a terceira consulta veio aos 10 s.
  assert.equal(tempo.decorrido, 2 * PAYMENT_POLL_INTERVAL_MS);
  // Mantém a chave durante toda a espera.
  assert.equal(nextIdempotencyKey(chaveUsada, { status: 409, code: "PAYMENT_IN_PROGRESS" }, gerar), chaveUsada);
});

test("409 → consulta → recusado: aplica o fluxo da recusa (chave nova)", async () => {
  const tempo = relogio();
  const chave = "chave-do-409";
  const resultado = await pollPaymentAttempt({
    check: async () => (tempo.decorrido < 15_000 ? { outcome: "processing" } : { outcome: "declined" }),
    wait: tempo.wait,
    now: tempo.now,
  });
  assert.deepEqual(resultado, { kind: "declined" });
  // O checkout trata como recusa definitiva: chave NOVA.
  const nova = nextIdempotencyKey(chave, { status: 402, code: "CARD_PAYMENT_DECLINED" }, gerar);
  assert.notEqual(nova, chave);
});

test("409 por 2 minutos: mensagem final, sem chave nova e sem aprovar nem recusar", async () => {
  const tempo = relogio();
  let consultas = 0;
  const resultado = await pollPaymentAttempt({
    check: async () => {
      consultas += 1;
      return { outcome: "processing" };
    },
    wait: tempo.wait,
    now: tempo.now,
  });
  assert.deepEqual(resultado, { kind: "timeout" });
  assert.equal(tempo.decorrido, PAYMENT_POLL_TIMEOUT_MS);
  assert.equal(consultas, PAYMENT_POLL_TIMEOUT_MS / PAYMENT_POLL_INTERVAL_MS); // 24 consultas
  // Nenhuma chave nova no desfecho do tempo esgotado.
  assert.equal(nextIdempotencyKey("chave-do-409", { status: 409, code: "PAYMENT_IN_PROGRESS" }, gerar), "chave-do-409");
});

test("erro de rede, 401 e resposta torta na consulta contam como 'ainda processando'", async () => {
  const tempo = relogio();
  const respostas = [
    () => {
      throw new Error("rede");
    },
    () => null, // 401/429/5xx: o checkout devolve null
    () => ({ outcome: "created" }), // sem confirmationUrl: não vale
    () => ({ outcome: "created", confirmationUrl: "/checkout/confirmacao?attempt=k" }),
  ];
  let indice = 0;
  const resultado = await pollPaymentAttempt({
    check: async () => respostas[indice++](),
    wait: tempo.wait,
    now: tempo.now,
  });
  assert.equal(resultado.kind, "created");
  assert.equal(indice, 4);
});

test("sair da página interrompe a espera", async () => {
  const tempo = relogio();
  let cancelado = false;
  const resultado = await pollPaymentAttempt({
    check: async () => {
      cancelado = true;
      return { outcome: "processing" };
    },
    wait: tempo.wait,
    now: tempo.now,
    isCancelled: () => cancelado,
  });
  assert.deepEqual(resultado, { kind: "cancelled" });
});

test("a rota: o 409 de reconciliação ganha o código PAYMENT_IN_PROGRESS e nada mais muda", () => {
  const route = read("app/api/checkout/payment/route.ts");
  assert.equal(route.split('"PAYMENT_IN_PROGRESS",').length - 1, 3);
  for (const trecho of [
    "Boleto em reconciliação; uma nova cobrança não será criada.",
    "Pagamento com cartão em reconciliação; uma nova cobrança não será criada.",
    "Pagamento com carteira digital em reconciliação; uma nova cobrança não será criada.",
  ]) {
    assert.ok(route.includes(trecho));
  }
  assert.ok(read("lib/commerce/checkoutTransfer.ts").includes('| "PAYMENT_IN_PROGRESS"'));
});

test("a consulta da tentativa é só leitura e só para quem criou o pedido", () => {
  const route = read("app/api/checkout/payment/attempt/route.ts");
  assert.ok(route.includes("export async function GET"));
  for (const proibido of [
    "export async function POST",
    "createPendingOrder",
    "createPix",
    "createBoleto",
    "createCardCharge",
    "transitionCheckoutAttempt",
    "reserveCheckoutAttempt",
    "reconcileCheckoutAttempt",
    "markOrderAsFailed",
    "after(",
  ]) {
    assert.ok(!route.includes(proibido), `não pode haver ${proibido}`);
  }
  assert.ok(route.includes("isAuthorizedForOrderStatus(order, cartToken, session?.customer.email)"));
  assert.ok(route.includes("rateLimiter.isLimited(request.headers)"));
  // Dúvida vira "processing": nada é liberado por engano.
  assert.ok(route.includes('"processing" satisfies AttemptOutcome'));
});

test("checkout: espera com a mesma chave, trava novo pagamento e mostra o WhatsApp no fim", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const inicio = form.indexOf("if (isPaymentInProgress(outcome)) {");
  const fim = form.indexOf("const message = declined", inicio);
  assert.ok(inicio > -1 && fim > inicio);
  const espera = form.slice(inicio, fim);
  // A consulta usa a chave do envio, nunca uma nova.
  assert.ok(espera.includes("check: () => checkAttempt(idempotencyKey)"));
  // A única troca de chave na espera é a da recusa definitiva.
  assert.equal(espera.split("checkoutAttemptIdRef.current = ").length - 1, 1);
  const recusa = espera.slice(espera.indexOf('if (polled.kind === "declined")'), espera.indexOf("// 2 minutos"));
  assert.ok(recusa.includes("checkoutAttemptIdRef.current = nextIdempotencyKey("));
  // O tempo esgotado não troca a chave, não oferece Pix e não libera nada.
  const tempoEsgotado = espera.slice(espera.indexOf("// 2 minutos"));
  assert.ok(tempoEsgotado.includes('setPaymentProcessing("timeout")'));
  assert.ok(!tempoEsgotado.includes("checkoutAttemptIdRef"));
  assert.ok(!tempoEsgotado.includes("setSuggestPix"));
  assert.ok(!tempoEsgotado.includes('setPaymentProcessing("idle")'));
  // Nenhum novo pagamento nesse estado: ignorado no envio, botão e barra do celular travados.
  assert.ok(form.includes('if (paymentProcessing !== "idle") return;'));
  assert.ok(form.includes('paymentProcessing !== "idle"}\n                aria-describedby="checkout-submit-status"'));
  assert.ok(form.includes('disabled={isCheckoutUpdating || paymentProcessing !== "idle"}'));
  // A área de pagamento fica inerte (nem trocar de forma de pagamento) e o formulário não é apagado.
  assert.ok(form.includes('inert={paymentProcessing !== "idle"}'));
  assert.ok(!espera.includes("reset("));

  const aviso = read("components/Checkout/PaymentProcessingNotice.tsx");
  assert.ok(aviso.includes("PAYMENT_PROCESSING_MESSAGE"));
  assert.ok(aviso.includes("PAYMENT_TIMEOUT_MESSAGE"));
  assert.ok(aviso.includes("LoaderCircle"));
  assert.ok(aviso.includes("<LinkWhatsApp"));
  assert.ok(!aviso.includes("Pix"));
});
