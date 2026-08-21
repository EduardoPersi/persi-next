import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

class SharedWordPressAttemptTable {
  rows = new Map();
  reserve(id) {
    if (this.rows.has(id)) return { acquired: false, row: this.rows.get(id) };
    const row = { state: "RESERVED", orderId: null };
    this.rows.set(id, row);
    return { acquired: true, row };
  }
}

async function nextInstance(table, attemptId, createOrder) {
  const reservation = table.reserve(attemptId);
  if (!reservation.acquired) return reservation.row;
  await Promise.resolve();
  reservation.row.orderId = await createOrder();
  reservation.row.state = "ORDER_CREATED";
  return reservation.row;
}

test("20 chamadas em duas instâncias Next com a mesma tentativa criam exatamente 1 pedido", async () => {
  const wordpress = new SharedWordPressAttemptTable();
  let ordersCreated = 0;
  const createOrder = async () => ++ordersCreated;
  const instanceA = (id) => nextInstance(wordpress, id, createOrder);
  const instanceB = (id) => nextInstance(wordpress, id, createOrder);
  const calls = Array.from({ length: 20 }, (_, index) =>
    (index % 2 ? instanceA : instanceB)("5b1f6f2a-3b0e-4f2a-9a8e-2f5a6b0c1d2e"),
  );
  await Promise.all(calls);
  assert.equal(ordersCreated, 1);
  assert.equal(wordpress.rows.size, 1);
});

test("schema usa unicidade real e migração permanece restrita à ativação", async () => {
  const activator = await readFile("wordpress-plugin/persi-headless-checkout/src/Activator.php", "utf8");
  const plugin = await readFile("wordpress-plugin/persi-headless-checkout/persi-headless-checkout.php", "utf8");
  assert.match(activator, /UNIQUE KEY checkout_attempt_id/);
  assert.match(plugin, /register_activation_hook/);
  assert.doesNotMatch(plugin, /dbDelta/);
});

test("máquina de estados não permite regressão silenciosa", async () => {
  const repository = await readFile("wordpress-plugin/persi-headless-checkout/src/Checkout/CheckoutAttemptRepository.php", "utf8");
  assert.match(repository, /RESERVED:ORDER_CREATED/);
  assert.match(repository, /ORDER_CREATED:PAYMENT_CREATING/);
  assert.match(repository, /PAYMENT_CREATING:PAYMENT_CREATED/);
  assert.doesNotMatch(repository, /PAYMENT_CREATED:RESERVED/);
});
