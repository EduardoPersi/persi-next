import assert from "node:assert/strict";
import test from "node:test";
import {
  attachPaymentReference,
  createPendingOrder,
  findOrderByIdempotencyKey,
  findOrderByPaymentReference,
  findPendingOrdersWithPaymentReference,
  getCheckoutOwnerToken,
  markOrderAsFailed,
  markOrderAsPaid,
  WooCommerceRestError,
} from "../services/woocommerce/orders.ts";

// `services/woocommerce/restClient.ts` importa "server-only" (as credenciais
// do WooCommerce nunca podem rodar fora de um contexto de servidor) e por
// isso não é importado diretamente por testes unitários — como os demais
// módulos com essa guarda no projeto.

const billingAddress = {
  firstName: "Maria",
  lastName: "Silva",
  address1: "Rua do Rosário, 1",
  city: "Jundiaí",
  state: "SP",
  postcode: "13201000",
  country: "BR",
  email: "maria@example.com",
};

test("createPendingOrder rejeita carrinho vazio antes de chamar a API", async () => {
  await assert.rejects(
    createPendingOrder({
      idempotencyKey: "key-1",
      items: [],
      billingAddress,
      shippingAddress: billingAddress,
      paymentMethod: "inter_pix",
      ownerToken: "cart-token-1",
    }),
    WooCommerceRestError,
  );
});

test("createPendingOrder monta line_items sem preço e grava idempotency key/provider/owner token", async () => {
  const calls = [];
  const post = async (endpoint, body) => {
    calls.push({ endpoint, body });
    return {
      id: 501,
      status: "pending",
      total: "199.90",
      currency: "BRL",
      billing: { email: "maria@example.com" },
      meta_data: [
        { key: "_persi_idempotency_key", value: "key-1" },
        { key: "_persi_payment_provider", value: "inter" },
        { key: "_persi_checkout_owner_token", value: "cart-token-1" },
      ],
    };
  };

  const order = await createPendingOrder(
    {
      idempotencyKey: "key-1",
      items: [
        { productId: 10, variationId: 0, quantity: 2 },
        { productId: 20, variationId: 30, quantity: 1 },
      ],
      billingAddress,
      shippingAddress: billingAddress,
      paymentMethod: "inter_pix",
      ownerToken: "cart-token-1",
    },
    post,
  );

  assert.equal(order.id, 501);
  assert.equal(order.status, "pending");
  assert.equal(order.billingEmail, "maria@example.com");
  assert.equal(getCheckoutOwnerToken(order), "cart-token-1");
  assert.equal(calls[0].endpoint, "orders");
  assert.equal(calls[0].body.set_paid, false);
  assert.equal(calls[0].body.line_items.length, 2);
  assert.equal(calls[0].body.line_items[0].product_id, 10);
  assert.equal("price" in calls[0].body.line_items[0], false);
  assert.equal(calls[0].body.line_items[1].variation_id, 30);
  assert.deepEqual(
    calls[0].body.meta_data.find((m) => m.key === "_persi_idempotency_key"),
    { key: "_persi_idempotency_key", value: "key-1" },
  );
  assert.deepEqual(
    calls[0].body.meta_data.find((m) => m.key === "_persi_checkout_owner_token"),
    { key: "_persi_checkout_owner_token", value: "cart-token-1" },
  );
});

test("getCheckoutOwnerToken retorna string vazia quando o pedido não tem o meta", () => {
  const orderWithoutToken = { id: 1, status: "pending", metaData: {} };
  assert.equal(getCheckoutOwnerToken(orderWithoutToken), "");
});

test("findOrderByIdempotencyKey busca por meta_key/meta_value e retorna null se não achar", async () => {
  const getList = async (endpoint, query) => {
    assert.equal(endpoint, "orders");
    assert.equal(query.meta_key, "_persi_idempotency_key");
    assert.equal(query.meta_value, "key-2");
    return [];
  };

  const order = await findOrderByIdempotencyKey("key-2", getList);
  assert.equal(order, null);
});

test("attachPaymentReference grava provider e externalId como meta_data", async () => {
  const put = async (endpoint, body) => {
    assert.equal(endpoint, "orders/501");
    assert.equal(body.meta_data[1].value, "TX123");
    return {
      id: 501,
      status: "pending",
      total: "199.90",
      currency: "BRL",
      meta_data: body.meta_data,
    };
  };

  const order = await attachPaymentReference(501, { provider: "inter", externalId: "TX123" }, put);
  assert.equal(order.metaData._persi_payment_reference, "TX123");
});

test("findOrderByPaymentReference filtra pelo provider correto entre resultados", async () => {
  const getList = async () => [
    {
      id: 1,
      status: "pending",
      total: "10",
      currency: "BRL",
      meta_data: [
        { key: "_persi_payment_provider", value: "pagbank" },
        { key: "_persi_payment_reference", value: "SAME-ID" },
      ],
    },
    {
      id: 2,
      status: "pending",
      total: "10",
      currency: "BRL",
      meta_data: [
        { key: "_persi_payment_provider", value: "inter" },
        { key: "_persi_payment_reference", value: "SAME-ID" },
      ],
    },
  ];

  const order = await findOrderByPaymentReference("inter", "SAME-ID", getList);
  assert.equal(order.id, 2);
});

test("markOrderAsPaid é idempotente: não reescreve se já pago com a mesma referência", async () => {
  let putCalls = 0;
  const put = async () => {
    putCalls += 1;
    throw new Error("não deveria escrever de novo");
  };

  const alreadyPaidOrder = {
    id: 501,
    status: "processing",
    total: "199.90",
    currency: "BRL",
    metaData: { _persi_payment_reference: "TX123" },
  };

  const result = await markOrderAsPaid(
    alreadyPaidOrder,
    { provider: "inter", externalId: "TX123" },
    put,
  );

  assert.equal(putCalls, 0);
  assert.equal(result.status, "processing");
});

test("markOrderAsPaid grava status processing e set_paid quando ainda pendente", async () => {
  const put = async (endpoint, body) => {
    assert.equal(endpoint, "orders/501");
    assert.equal(body.status, "processing");
    assert.equal(body.set_paid, true);
    return {
      id: 501,
      status: "processing",
      total: "199.90",
      currency: "BRL",
      meta_data: body.meta_data,
    };
  };

  const pendingOrder = {
    id: 501,
    status: "pending",
    total: "199.90",
    currency: "BRL",
    metaData: {},
  };

  const result = await markOrderAsPaid(
    pendingOrder,
    { provider: "inter", externalId: "TX123" },
    put,
  );
  assert.equal(result.status, "processing");
});

test("markOrderAsFailed é idempotente: não reescreve pedido já cancelado", async () => {
  let putCalls = 0;
  const put = async () => {
    putCalls += 1;
    throw new Error("não deveria escrever de novo");
  };

  const cancelledOrder = {
    id: 501,
    status: "cancelled",
    total: "199.90",
    currency: "BRL",
    metaData: {},
  };

  const result = await markOrderAsFailed(cancelledOrder, "cancelled", put);
  assert.equal(putCalls, 0);
  assert.equal(result.status, "cancelled");
});

test("findPendingOrdersWithPaymentReference busca pedidos pending com referência de pagamento", async () => {
  const getList = async (endpoint, query) => {
    assert.equal(endpoint, "orders");
    assert.equal(query.status, "pending");
    assert.equal(query.meta_key, "_persi_payment_reference");
    return [
      {
        id: 1,
        status: "pending",
        total: "10",
        currency: "BRL",
        payment_method: "inter_pix",
        meta_data: [{ key: "_persi_payment_reference", value: "TX1" }],
      },
    ];
  };

  const orders = await findPendingOrdersWithPaymentReference(getList);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].paymentMethod, "inter_pix");
  assert.equal(orders[0].metaData._persi_payment_reference, "TX1");
});

test("findPendingOrdersWithPaymentReference descarta pedidos sem referência de pagamento", async () => {
  const getList = async () => [
    { id: 2, status: "pending", total: "10", currency: "BRL", meta_data: [] },
  ];

  const orders = await findPendingOrdersWithPaymentReference(getList);
  assert.equal(orders.length, 0);
});
