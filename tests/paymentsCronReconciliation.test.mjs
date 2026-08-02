import assert from "node:assert/strict";
import test from "node:test";
import {
  createOverlapGuard,
  isAuthorizedCronRequest,
  reconcilePendingOrders,
  safeCompareSecret,
} from "../services/payments/cronReconciliation.ts";

test("safeCompareSecret aceita valores iguais e rejeita diferentes ou de tamanho distinto", () => {
  assert.equal(safeCompareSecret("segredo", "segredo"), true);
  assert.equal(safeCompareSecret("segredo", "outro-segredo"), false);
  assert.equal(safeCompareSecret("abc", "abcd"), false);
});

test("isAuthorizedCronRequest exige header Bearer com o CRON_SECRET exato", () => {
  assert.equal(isAuthorizedCronRequest("Bearer minha-chave", "minha-chave"), true);
  assert.equal(isAuthorizedCronRequest("Bearer errada", "minha-chave"), false);
  assert.equal(isAuthorizedCronRequest(null, "minha-chave"), false);
  assert.equal(isAuthorizedCronRequest("minha-chave", "minha-chave"), false); // sem "Bearer "
  assert.equal(isAuthorizedCronRequest("Bearer minha-chave", ""), false);
  assert.equal(isAuthorizedCronRequest("Bearer minha-chave", undefined), false);
});

test("isAuthorizedCronRequest nunca autoriza quando CRON_SECRET não está configurado, mesmo sem header nenhum", () => {
  assert.equal(isAuthorizedCronRequest(null, undefined), false);
});

function makeOrders(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
}

test("reconcilePendingOrders processa todos os pedidos quando cabe no orçamento de tempo", async () => {
  const orders = makeOrders(12);
  const processed = [];
  const summary = await reconcilePendingOrders(orders, {
    timeBudgetMs: 999_999,
    concurrency: 5,
    reconcileOrder: async (order) => {
      processed.push(order.id);
      return "paid";
    },
    getOrderId: (order) => order.id,
    now: () => 0,
  });

  assert.equal(summary.checked, 12);
  assert.equal(summary.paid, 12);
  assert.equal(summary.truncated, false);
  assert.equal(summary.remaining, 0);
  assert.deepEqual(processed.sort((a, b) => a - b), orders.map((o) => o.id));
});

test("reconcilePendingOrders processa em lotes de acordo com a concorrência configurada", async () => {
  const orders = makeOrders(11);
  let maxConcurrentInFlight = 0;
  let currentInFlight = 0;

  await reconcilePendingOrders(orders, {
    timeBudgetMs: 999_999,
    concurrency: 3,
    reconcileOrder: async () => {
      currentInFlight += 1;
      maxConcurrentInFlight = Math.max(maxConcurrentInFlight, currentInFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      currentInFlight -= 1;
      return "pending";
    },
    getOrderId: (order) => order.id,
    now: () => 0,
  });

  assert.equal(maxConcurrentInFlight, 3);
});

test("reconcilePendingOrders trunca a varredura quando o orçamento de tempo estoura", async () => {
  const orders = makeOrders(20);
  // Relógio controlado: o primeiro lote (concurrency=5) processa
  // normalmente; ao checar o orçamento antes do segundo lote, o tempo já
  // "passou" do limite.
  let calls = 0;
  const now = () => {
    calls += 1;
    // Chamada 1: `startedAt`. Chamada 2: checagem do orçamento antes do
    // primeiro lote (deixa passar). Chamada 3 em diante: checagem antes do
    // segundo lote (já estourou) e cálculo final de `durationMs`.
    return calls <= 2 ? 0 : 999;
  };

  const summary = await reconcilePendingOrders(orders, {
    timeBudgetMs: 500,
    concurrency: 5,
    reconcileOrder: async () => "pending",
    getOrderId: (order) => order.id,
    now,
  });

  assert.equal(summary.truncated, true);
  assert.equal(summary.checked, 5);
  assert.equal(summary.remaining, 15);
});

test("reconcilePendingOrders conta erros individuais sem interromper os demais pedidos do lote", async () => {
  const orders = makeOrders(4);
  const errors = [];

  const summary = await reconcilePendingOrders(orders, {
    timeBudgetMs: 999_999,
    concurrency: 4,
    reconcileOrder: async (order) => {
      if (order.id === 2) throw new Error("falha simulada");
      return "failed";
    },
    getOrderId: (order) => order.id,
    onOrderError: (order, error) => errors.push({ orderId: order.id, message: error.message }),
    now: () => 0,
  });

  assert.equal(summary.checked, 4);
  assert.equal(summary.errors, 1);
  assert.equal(summary.failed, 3);
  assert.deepEqual(errors, [{ orderId: 2, message: "falha simulada" }]);
});

test("createOverlapGuard impede uma segunda aquisição até a primeira ser liberada", () => {
  const guard = createOverlapGuard();
  assert.equal(guard.tryAcquire(), true);
  assert.equal(guard.tryAcquire(), false);
  assert.equal(guard.isRunning, true);
  guard.release();
  assert.equal(guard.isRunning, false);
  assert.equal(guard.tryAcquire(), true);
});
