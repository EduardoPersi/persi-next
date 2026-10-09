import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createUniqueKeyLimiter } from "../lib/network/uniqueKeyLimiter.ts";
import { getTrustedClientIp } from "../lib/network/trustedIp.ts";
import {
  CARD_ATTEMPTS_EXCEEDED_MESSAGE,
  CARD_DECLINE_LIMIT,
  createCardDeclineCounter,
} from "../lib/commerce/cardDeclineLimit.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// ---------- IP desconhecido ----------
test("IP desconhecido: o limite não se aplica e o aviso sai a cada ocorrência, com a rota e sem dado pessoal", () => {
  const avisos = [];
  const limitador = createUniqueKeyLimiter({
    windowMs: 60_000,
    maxAttempts: 10,
    route: "/api/checkout/payment",
    getIp: getTrustedClientIp,
    warn: (mensagem, dados) => avisos.push({ mensagem, dados }),
  });
  const semIp = new Headers({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "8.8.8.8" });
  // 50 chaves distintas sem IP confiável: nunca barra e não cria balde "desconhecido".
  for (let i = 1; i <= 50; i += 1) assert.equal(limitador.isLimited(semIp, `chave-${i}`), false);
  assert.equal(avisos.length, 50);
  assert.deepEqual(avisos[0].dados, { route: "/api/checkout/payment", ocorrencias: 1 });
  assert.equal(avisos[49].dados.ocorrencias, 50);
  assert.ok(avisos[0].mensagem.includes("IP de confiança não identificado"));
  // Nada de dado pessoal: nem os IPs dos cabeçalhos, nem as chaves.
  const log = JSON.stringify(avisos);
  for (const proibido of ["9.9.9.9", "8.8.8.8", "chave-1"]) assert.ok(!log.includes(proibido));

  // Com IP confiável, o limite funciona como sempre, sem herdar nada do "desconhecido".
  const comIp = new Headers({ "cf-connecting-ip": "203.0.113.7" });
  for (let i = 1; i <= 10; i += 1) assert.equal(limitador.isLimited(comIp, `k${i}`), false);
  assert.equal(limitador.isLimited(comIp, "k11"), true);
  assert.equal(avisos.length, 50, "com IP confiável não sai aviso");
});

test("a rota registra o IP desconhecido com o nome da rota", () => {
  const route = read("app/api/checkout/payment/route.ts");
  assert.ok(route.includes('"/api/checkout/payment",\n);'));
  const limitador = read("lib/network/rateLimit.ts");
  assert.ok(limitador.includes("route,"));
  assert.ok(limitador.includes("getIp: getTrustedClientIp"));
});

// ---------- IP confiável ----------
test("IP confiável: só o cf-connecting-ip da Cloudflare; x-forwarded-for e x-real-ip forjados não valem", () => {
  assert.equal(getTrustedClientIp(new Headers({ "cf-connecting-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(getTrustedClientIp(new Headers({ "cf-connecting-ip": " 2001:db8::1 " })), "2001:db8::1");
  // Sem o cabeçalho da Cloudflare, o que o cliente escreve NÃO conta.
  assert.equal(getTrustedClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "");
  assert.equal(getTrustedClientIp(new Headers({ "x-real-ip": "1.2.3.4" })), "");
  // Valor que não é IP não vale (nada de usar texto livre como chave do balde).
  assert.equal(getTrustedClientIp(new Headers({ "cf-connecting-ip": "qualquer-coisa" })), "");
  assert.equal(getTrustedClientIp(new Headers({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" })), "");
  // Presente e válido, ele ganha de qualquer x-forwarded-for.
  assert.equal(
    getTrustedClientIp(new Headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6" })),
    "203.0.113.7",
  );
});

test("os outros 9 limitadores continuam exatamente como estavam", () => {
  const limitador = read("lib/network/rateLimit.ts");
  const base = limitador.slice(0, limitador.indexOf("export function createUniqueKeyRateLimiter"));
  assert.ok(base.includes('const ip = getRequestIp(headers) || "unknown";'));
  const rotas = [
    "app/api/cep/[cep]/route.ts",
    "app/api/contact/route.ts",
    "app/api/newsletter/route.ts",
    "app/api/painel/produtos/route.ts",
    "app/api/search/suggestions/route.ts",
    "app/api/shipping/postcode/route.ts",
    "app/api/stock-notifications/route.ts",
    "app/api/checkout/cart-signal/route.ts",
    "app/r/[token]/route.ts",
  ];
  for (const rota of rotas) {
    const fonte = read(rota);
    assert.ok(fonte.includes("createRateLimiter("), `${rota} usa createRateLimiter`);
    assert.ok(!fonte.includes("trustedIp") && !fonte.includes("createUniqueKeyRateLimiter"), `${rota} não muda`);
  }
  // O getRequestIp (reCAPTCHA e demais) não foi alterado.
  assert.ok(read("lib/recaptcha/verify.ts").includes('headers.get("x-forwarded-for")?.split(",")[0]?.trim()'));
});

// ---------- limite de recusas de cartão por pedido ----------
test("5 recusas de cartão no mesmo pedido, com IPs diferentes: a 6ª tentativa é barrada", () => {
  assert.equal(CARD_DECLINE_LIMIT, 5);
  assert.equal(
    CARD_ATTEMPTS_EXCEEDED_MESSAGE,
    "Muitas tentativas com cartão neste pedido. Para continuar, pague com Pix.",
  );
  const contador = createCardDeclineCounter();
  const sessao = "a".repeat(64);
  // Cada tentativa vem de um IP diferente (uma, sem IP nenhum). O contador não
  // recebe IP: só a sessão do carrinho, que é o pedido.
  const ips = ["1.1.1.1", "2.2.2.2", "", "3.3.3.3", "4.4.4.4", "5.5.5.5"];
  const resultados = ips.map((ip) => {
    void ip;
    const barrada = contador.isBlocked(sessao);
    if (!barrada) contador.recordDecline(sessao);
    return barrada;
  });
  assert.deepEqual(resultados, [false, false, false, false, false, true]);
  assert.equal(contador.isBlocked(sessao), true);
});

test("o limite por pedido é por carrinho, expira e ignora sessão vazia", () => {
  let agora = 1_000;
  const contador = createCardDeclineCounter(5, 24 * 3600_000, () => agora);
  for (let i = 0; i < 5; i += 1) contador.recordDecline("sessao-a");
  assert.equal(contador.isBlocked("sessao-a"), true);
  assert.equal(contador.isBlocked("sessao-b"), false);
  contador.recordDecline("sessao-b");
  assert.equal(contador.isBlocked("sessao-b"), false);
  assert.equal(contador.isBlocked(""), false);
  contador.recordDecline("");
  agora += 24 * 3600_000 + 1;
  assert.equal(contador.isBlocked("sessao-a"), false);
});

test("rota: o limite por pedido vale sem IP, só para cartão, e só conta recusa nova", () => {
  const route = read("app/api/checkout/payment/route.ts");
  const bloqueio = route.indexOf("cardDeclines.isBlocked(sessaoDoPedido)");
  const limiteIp = route.indexOf("paymentRateLimiter.isLimited(request.headers");
  assert.ok(limiteIp > -1 && bloqueio > limiteIp);
  // O bloqueio por pedido está FORA do `if` do limite por IP: não depende do IP.
  const entre = route.slice(limiteIp, bloqueio);
  assert.ok(entre.includes("return limited;\n    }"));
  // Só cartão (Pix e boleto não são afetados) e só com a chave de limite ligada.
  assert.ok(route.includes("pagamentoRateLimitLigado() &&\n      CARD_PAYMENT_METHODS.has(input.method) &&\n      sessaoDoPedido &&"));
  assert.ok(route.includes('code: "CARD_ATTEMPTS_EXCEEDED", message: CARD_ATTEMPTS_EXCEEDED_MESSAGE'));
  // Antes do carrinho, da reserva da tentativa e de qualquer gateway.
  assert.ok(bloqueio < route.indexOf("await getCart(activeCartToken)"));
  assert.ok(bloqueio < route.indexOf("reserveCheckoutAttempt(input.idempotencyKey"));
  // Conta as duas recusas novas de cartão, logo depois de marcar o pedido como falho;
  // a reexibição da mesma recusa (mesma chave) não passa por aqui.
  const marca = 'await markOrderAsFailed(order, "failed");\n        if (sessaoDoPedido) cardDeclines.recordDecline(sessaoDoPedido);';
  assert.equal(route.split(marca).length - 1, 2);
  assert.equal(route.split("cardDeclines.recordDecline(").length - 1, 2);
});

// ---------- mesma chave depois de uma recusa ----------
test("mesma chave depois de recusa: nunca gera outra cobrança de cartão, só repete o resultado", () => {
  const route = read("app/api/checkout/payment/route.ts");
  const reserva = route.indexOf("if (!reservation.acquired) {");
  const repeteRecusa = route.indexOf("return createCardDeclinedResponse(\n            Number(reservation.attempt.order_id)");
  const mercadoPago = route.indexOf("await createMercadoPagoCardCharge(");
  const pagBank = route.indexOf("await createPagBankCardCharge(");
  // Chave já usada: devolve o resultado guardado ANTES de qualquer cobrança nova.
  assert.ok(reserva > -1 && repeteRecusa > reserva && repeteRecusa < mercadoPago && repeteRecusa < pagBank);
  // Quem chega à cobrança de cartão com a chave "em criação" recebe 409 e não cobra.
  const guardaMp = route.indexOf('if (attemptState === "PAYMENT_CREATING")', route.indexOf('input.method === "mercadopago_card"'));
  assert.ok(guardaMp > -1 && guardaMp < mercadoPago);
  const guardaPb = route.lastIndexOf('if (attemptState === "PAYMENT_CREATING")', pagBank);
  assert.ok(guardaPb > guardaMp && guardaPb < pagBank);

  // No plugin do WordPress, só dá para retomar a chave enquanto não houve cobrança criada.
  const plugin = read("wordpress-plugin/persi-headless-checkout/src/Checkout/CheckoutAttemptRepository.php");
  assert.ok(plugin.includes("state IN ('RESERVED', 'ORDER_CREATED', 'PAYMENT_CREATING') AND lease_expires_at < %s"));
});
