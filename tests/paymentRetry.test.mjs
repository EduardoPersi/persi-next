import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CARD_DECLINED_RETRY_MESSAGE,
  isDefinitiveCardFailure,
  nextIdempotencyKey,
  shouldSuggestPix,
} from "../lib/commerce/paymentRetry.ts";
import { createCardDeclineCounter } from "../lib/commerce/cardDeclineLimit.ts";
import { createUniqueKeyWindow } from "../lib/network/uniqueKeyWindow.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

let contador = 0;
const gerar = () => `chave-nova-${++contador}`;

test("recusa definitiva de cartão: chave NOVA", () => {
  const recusa = { status: 402, code: "CARD_PAYMENT_DECLINED" };
  assert.equal(isDefinitiveCardFailure(recusa), true);
  assert.equal(nextIdempotencyKey("chave-1", recusa, gerar), "chave-nova-1");
  assert.equal(shouldSuggestPix(recusa), true);
});

test("processamento, reconciliação, limite, erro do servidor e erro de rede: MESMA chave", () => {
  const casos = [
    { status: 409, code: "CHECKOUT_IN_PROGRESS" }, // já está sendo processado
    { status: 409, code: "PROVIDER_REQUEST_FAILED" }, // "em reconciliação" (PAYMENT_CREATING)
    { status: 409, code: "ORDER_TOTAL_MISMATCH" },
    { status: 429, code: "RATE_LIMITED" },
    { status: 429, code: "CARD_ATTEMPTS_EXCEEDED" },
    { status: 422, code: "VALIDATION" },
    { status: 400, code: "REQUEST_VALIDATION" },
    { status: 500, code: "UNKNOWN" },
    { status: 502, code: "PROVIDER_REQUEST_FAILED" },
    { status: 503, code: "PROVIDER_AUTH_FAILED" },
    { status: 402, code: "OUTRO_CODIGO" }, // 402 que não é recusa de cartão
    { status: 200, code: undefined },
    {}, // erro de rede: não houve resposta
  ];
  for (const caso of casos) {
    assert.equal(isDefinitiveCardFailure(caso), false, JSON.stringify(caso));
    assert.equal(nextIdempotencyKey("chave-1", caso, gerar), "chave-1", JSON.stringify(caso));
  }
  // O limite de cartões do pedido não troca a chave, mas oferece o Pix.
  assert.equal(shouldSuggestPix({ status: 429, code: "CARD_ATTEMPTS_EXCEEDED" }), true);
  assert.equal(shouldSuggestPix({ status: 409, code: "CHECKOUT_IN_PROGRESS" }), false);
  assert.equal(shouldSuggestPix({}), false);
});

test("a mensagem da recusa é a aprovada", () => {
  assert.equal(
    CARD_DECLINED_RETRY_MESSAGE,
    "Pagamento não aprovado. Confira os dados do cartão, tente outro cartão ou pague com Pix.",
  );
});

test("recusa → nova chave → nova tentativa funciona; os limites continuam valendo", () => {
  // O servidor: limite por IP (10 chaves distintas por minuto) e 5 recusas por pedido.
  const agora = () => 1_000_000;
  const porIp = createUniqueKeyWindow(60_000, 10, agora);
  const recusas = createCardDeclineCounter(5, 24 * 3600_000, agora);
  const sessao = "s".repeat(64);
  const ip = "203.0.113.7";

  let chave = "chave-inicial";
  const chavesUsadas = [chave];
  const resultados = [];
  // O cliente tenta o cartão várias vezes seguidas, sem recarregar a página.
  for (let tentativa = 1; tentativa <= 6; tentativa += 1) {
    const limitadaPorIp = porIp.isLimited(ip, chave);
    const limitadaPorPedido = recusas.isBlocked(sessao);
    if (limitadaPorIp || limitadaPorPedido) {
      resultados.push(limitadaPorPedido ? "pedido-barrado" : "ip-barrado");
      // Não é recusa definitiva (429): a chave é mantida.
      chave = nextIdempotencyKey(chave, { status: 429, code: "CARD_ATTEMPTS_EXCEEDED" }, gerar);
      continue;
    }
    // O gateway recusa; o servidor devolve 402 e o checkout troca a chave.
    recusas.recordDecline(sessao);
    resultados.push("recusado");
    chave = nextIdempotencyKey(chave, { status: 402, code: "CARD_PAYMENT_DECLINED" }, gerar);
    chavesUsadas.push(chave);
  }
  assert.deepEqual(resultados, ["recusado", "recusado", "recusado", "recusado", "recusado", "pedido-barrado"]);
  // Cada tentativa nova usou uma chave diferente (e contou no limite por IP).
  assert.equal(new Set(chavesUsadas).size, chavesUsadas.length);

  // Pix com chave nova continua passando: o limite por pedido é só de cartão.
  assert.equal(porIp.isLimited(ip, "chave-do-pix"), false);
  // A 11ª chave distinta no mesmo minuto é barrada pelo limite por IP.
  const outroIp = "198.51.100.9";
  for (let i = 1; i <= 10; i += 1) assert.equal(porIp.isLimited(outroIp, `k${i}`), false);
  assert.equal(porIp.isLimited(outroIp, "k11"), true);
});

test("checkout: chave nova só na falha definitiva, formulário intocado, Pix em destaque", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");

  // A chave só é atribuída na criação e no ramo de falha, via nextIdempotencyKey.
  // Só na recusa direta e na recusa descoberta durante a espera (paymentPolling).
  assert.equal(form.split("checkoutAttemptIdRef.current = ").length - 1, 2);
  assert.equal(form.split("checkoutAttemptIdRef.current = nextIdempotencyKey(").length - 1, 2);
  const inicio = form.indexOf("if (!response.ok || !result) {");
  const fim = form.indexOf("if (result.alreadyInitiated)", inicio);
  const falha = form.slice(inicio, fim);
  assert.ok(falha.includes("isDefinitiveCardFailure(outcome)"));
  assert.ok(falha.includes("CARD_DECLINED_RETRY_MESSAGE"));
  // O formulário não é apagado nem recarregado na falha.
  for (const proibido of ["reset(", "methods.reset", "location.reload", "router.refresh"]) {
    assert.ok(!falha.includes(proibido), `não pode haver ${proibido} na falha`);
  }
  // A única navegação na falha é a da espera do pagamento "em processamento",
  // quando o banco confirma que a cobrança existe (paymentPolling).
  assert.equal(falha.split("navigate(").length - 1, 1);
  const espera = falha.slice(falha.indexOf("if (isPaymentInProgress(outcome)) {"), falha.indexOf("const message = declined"));
  assert.ok(espera.includes("navigate(polled.confirmationUrl)"));

  // Erro de rede (catch) mantém a chave: o bloco não toca nela.
  const catchBloco = form.slice(
    form.indexOf("} catch {\n      setStatusMessage(\"Não foi possível iniciar o pagamento. Tente novamente.\");"),
    form.indexOf("} finally {\n      setIsSubmittingPayment(false);"),
  );
  assert.ok(catchBloco.length > 0);
  assert.ok(!catchBloco.includes("checkoutAttemptIdRef"));

  // Pix em destaque depois da recusa, trocando só a forma de pagamento.
  assert.ok(form.includes("suggestPix={suggestPix}"));
  const pagamento = read("components/Checkout/CheckoutPayment.tsx");
  assert.ok(pagamento.includes("Pagar com Pix"));
  assert.ok(pagamento.includes('onClick={() => onMethodChange("inter_pix")}'));
  assert.ok(pagamento.includes("suggestPix && capabilities.pix && method !== \"inter_pix\""));
});

test("os limites do servidor não foram afrouxados", () => {
  const route = read("app/api/checkout/payment/route.ts");
  assert.ok(route.includes("paymentRateLimiter.isLimited(request.headers, input.idempotencyKey)"));
  assert.ok(route.includes("cardDeclines.isBlocked(sessaoDoPedido)"));
  assert.equal(route.split("cardDeclines.recordDecline(sessaoDoPedido)").length - 1, 2);
});
