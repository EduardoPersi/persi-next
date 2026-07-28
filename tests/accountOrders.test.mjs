import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AccountOrderValidationError, parseOrderId, parseOrdersQuery, parseOrdersResponse } from "../lib/account/orders.ts";
import { AccountServiceError } from "../services/account/client.ts";
import { getAccountOrder, getAccountOrders } from "../services/account/orders.ts";

const config = { endpoint: "https://persimateriais.com.br/wp-json/persi-account/v1", keyId: "primary", origin: "https://yellowgreen-ram-345959.hostingersite.com", secret: "test-only-account-secret" };
const token = "A".repeat(43);
const money = { value: "156.90", currency: "BRL", formatted: "R$ 156,90" };
const summary = { id: 1234, number: "1234", dateCreated: "2026-07-27T15:30:00-03:00", status: "processing", statusLabel: "Processando", total: money, itemCount: 3, paymentMethod: "pix", paymentMethodTitle: "Pix", shippingMethodTitle: "Melhor Envio", canOpen: true };

test("query de pedidos é fechada e limita per_page a 20", () => {
  assert.deepEqual(parseOrdersQuery(new URLSearchParams("page=2&per_page=20&status=processing")), { page: 2, perPage: 20, status: "processing" });
  assert.throws(() => parseOrdersQuery(new URLSearchParams("per_page=21")), AccountOrderValidationError);
  assert.throws(() => parseOrdersQuery(new URLSearchParams("customer_id=9")), AccountOrderValidationError);
  assert.throws(() => parseOrdersQuery(new URLSearchParams("status=private-status")), AccountOrderValidationError);
  assert.equal(parseOrderId("1234"), 1234);
  assert.throws(() => parseOrderId("0"));
});

test("listagem valida contrato e paginação", () => {
  const result = parseOrdersResponse({ orders: [summary], pagination: { page: 1, perPage: 10, totalItems: 25, totalPages: 3 } });
  assert.equal(result.orders[0].statusLabel, "Processando");
  assert.equal(result.pagination.totalPages, 3);
  assert.equal("customer_id" in result.orders[0], false);
});

test("serviço envia sessão, query segura, HMAC e no-store sem expor token", async () => {
  let request;
  const result = await getAccountOrders(token, { page: 2, perPage: 10, status: "processing" }, { config, fetchImplementation: async (url, init) => {
    request = { url, init };
    return Response.json({ orders: [summary], pagination: { page: 2, perPage: 10, totalItems: 11, totalPages: 2 } });
  } });
  assert.equal(result.orders.length, 1);
  assert.match(request.url, /orders\?page=2&per_page=10&status=processing$/);
  assert.equal(request.init.headers["X-Persi-Session"], token);
  assert.match(request.init.headers["X-Persi-Signature"], /^v1=[a-f0-9]{64}$/);
  assert.equal(request.init.cache, "no-store");
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("detalhe preserva 404 e erro remoto vira seguro", async () => {
  await assert.rejects(getAccountOrder(token, 999, { config, fetchImplementation: async () => Response.json({}, { status: 404 }) }), (error) => error instanceof AccountServiceError && error.status === 404);
  await assert.rejects(getAccountOrders(token, { page: 1, perPage: 10 }, { config, fetchImplementation: async () => { throw new Error("offline"); } }), AccountServiceError);
});

test("rotas e páginas são privadas e nunca serializam o token", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/api/account/orders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/orders/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(institutional)/minha-conta/pedidos/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(institutional)/minha-conta/pedidos/[id]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(files[0], /ACCOUNT_SESSION_COOKIE/);
  assert.match(files[0], /401/);
  assert.match(files[1], /Pedido não encontrado/);
  assert.match(files[2], /getServerAccountSession/);
  assert.match(files[3], /getServerAccountSession/);
  for (const source of files) assert.equal(source.includes("sessionToken:"), false);
});
