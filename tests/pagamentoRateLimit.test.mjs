import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createUniqueKeyWindow } from "../lib/network/uniqueKeyWindow.ts";
import {
  PAYMENT_RATE_LIMIT_MAX_ATTEMPTS,
  PAYMENT_RATE_LIMIT_MESSAGE,
  PAYMENT_RATE_LIMIT_WINDOW_MS,
  pagamentoRateLimitLigado,
} from "../lib/commerce/paymentRateLimit.ts";

const read = (path) => readFileSync(path, "utf8");

function relogio() {
  let agora = 1_000_000;
  return { now: () => agora, avancar: (ms) => (agora += ms) };
}

test("o limite é de 10 tentativas por minuto por IP", () => {
  assert.equal(PAYMENT_RATE_LIMIT_MAX_ATTEMPTS, 10);
  assert.equal(PAYMENT_RATE_LIMIT_WINDOW_MS, 60_000);

  const tempo = relogio();
  const janela = createUniqueKeyWindow(PAYMENT_RATE_LIMIT_WINDOW_MS, PAYMENT_RATE_LIMIT_MAX_ATTEMPTS, tempo.now);
  for (let tentativa = 1; tentativa <= 10; tentativa += 1) {
    assert.equal(janela.isLimited("1.2.3.4", `chave-${tentativa}`), false, `tentativa ${tentativa}`);
  }
  assert.equal(janela.isLimited("1.2.3.4", "chave-11"), true);
  assert.equal(janela.isLimited("1.2.3.4", "chave-12"), true);
});

test("a retentativa com a MESMA chave não conta como tentativa nova, nem no limite", () => {
  const tempo = relogio();
  const janela = createUniqueKeyWindow(60_000, 10, tempo.now);
  // Mesma chave 50 vezes: nunca passa de 1 tentativa.
  for (let i = 0; i < 50; i += 1) assert.equal(janela.isLimited("1.2.3.4", "mesma-chave"), false);
  // Sobram 9: o cliente ainda tem folga.
  for (let i = 1; i <= 9; i += 1) assert.equal(janela.isLimited("1.2.3.4", `outra-${i}`), false);
  assert.equal(janela.isLimited("1.2.3.4", "estoura"), true);
  // No limite, repetir uma chave que já tinha entrado continua passando.
  assert.equal(janela.isLimited("1.2.3.4", "mesma-chave"), false);
  assert.equal(janela.isLimited("1.2.3.4", "outra-3"), false);
});

test("quem foi barrado não alonga o próprio bloqueio e volta depois da janela", () => {
  const tempo = relogio();
  const janela = createUniqueKeyWindow(60_000, 10, tempo.now);
  for (let i = 1; i <= 10; i += 1) janela.isLimited("1.2.3.4", `c${i}`);
  tempo.avancar(30_000);
  assert.equal(janela.isLimited("1.2.3.4", "barrada"), true);
  assert.equal(janela.isLimited("1.2.3.4", "barrada"), true);
  // 61 s depois das primeiras 10, a janela esvaziou: a chave barrada agora entra.
  tempo.avancar(31_000);
  assert.equal(janela.isLimited("1.2.3.4", "barrada"), false);
  // E conta de novo, sem herdar o bloqueio anterior.
  for (let i = 1; i <= 9; i += 1) assert.equal(janela.isLimited("1.2.3.4", `n${i}`), false);
  assert.equal(janela.isLimited("1.2.3.4", "n10"), true);
});

test("cada IP tem a sua própria contagem", () => {
  const tempo = relogio();
  const janela = createUniqueKeyWindow(60_000, 10, tempo.now);
  for (let i = 1; i <= 10; i += 1) janela.isLimited("1.1.1.1", `a${i}`);
  assert.equal(janela.isLimited("1.1.1.1", "a11"), true);
  assert.equal(janela.isLimited("2.2.2.2", "b1"), false);
});

test("PAGAMENTO_RATE_LIMIT: ligado por padrão; 0, false e off desligam (staging)", () => {
  assert.equal(pagamentoRateLimitLigado({}), true);
  assert.equal(pagamentoRateLimitLigado({ PAGAMENTO_RATE_LIMIT: "" }), true);
  assert.equal(pagamentoRateLimitLigado({ PAGAMENTO_RATE_LIMIT: "1" }), true);
  assert.equal(pagamentoRateLimitLigado({ PAGAMENTO_RATE_LIMIT: "0" }), false);
  assert.equal(pagamentoRateLimitLigado({ PAGAMENTO_RATE_LIMIT: " FALSE " }), false);
  assert.equal(pagamentoRateLimitLigado({ PAGAMENTO_RATE_LIMIT: "off" }), false);
  assert.match(read(".env.example"), /^PAGAMENTO_RATE_LIMIT=1$/m);
});

test("a mensagem do 429 é a aprovada", () => {
  assert.equal(PAYMENT_RATE_LIMIT_MESSAGE, "Muitas tentativas. Aguarde um minuto e tente de novo.");
});

test("a rota barra DEPOIS de validar o corpo e ANTES de carrinho, pedido e gateways", () => {
  const route = read("app/api/checkout/payment/route.ts");
  const marcos = [
    "paymentInitiationSchema.safeParse(body)",
    "paymentRateLimiter.isLimited(request.headers, input.idempotencyKey)",
    "await getCart(activeCartToken)",
    "createPendingOrder(",
    "interPaymentGateway.createPix(",
    "createMercadoPagoCardCharge(",
  ].map((trecho) => route.indexOf(trecho));
  assert.ok(marcos.every((posicao) => posicao > -1), "faltou um marco na rota");
  assert.deepEqual([...marcos].sort((a, b) => a - b), marcos);
  // Só liga com a variável, e responde 429 com a mensagem e o código próprio.
  assert.ok(route.includes("pagamentoRateLimitLigado() &&"));
  assert.ok(route.includes('code: "RATE_LIMITED", message: PAYMENT_RATE_LIMIT_MESSAGE'));
  assert.ok(route.includes("429,"));
  assert.ok(route.includes('"Retry-After", "60"'));
  // O limitador é o de rateLimit.ts.
  assert.ok(route.includes('from "@/lib/network/rateLimit"'));
  assert.ok(read("lib/network/rateLimit.ts").includes("export function createUniqueKeyRateLimiter"));
});

test("o checkout mostra a mensagem ao cliente e mantém o formulário", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const inicio = form.indexOf("if (!response.ok || !result) {");
  const fim = form.indexOf("if (result.alreadyInitiated)", inicio);
  assert.ok(inicio > -1 && fim > inicio);
  const falha = form.slice(inicio, fim);
  assert.ok(falha.includes("result?.message"));
  assert.ok(falha.includes("setStatusMessage(message)"));
  assert.ok(falha.includes("return;"));
  // Falha de pagamento nunca limpa o formulário. A única navegação é a da espera
  // do pagamento "em processamento", quando o banco confirma que a cobrança existe.
  assert.ok(!falha.includes("reset("));
  assert.equal(falha.split("navigate(").length - 1, 1);
  assert.ok(falha.includes("navigate(polled.confirmationUrl)"));
});
