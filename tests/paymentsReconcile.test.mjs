import assert from "node:assert/strict";
import test from "node:test";
import {
  categorizeBoletoStatus,
  categorizeCardStatus,
  categorizePixStatus,
  reconcilePaymentReference,
} from "../services/payments/reconcile.ts";

const futureExpiry = new Date(Date.now() + 60_000).toISOString();
const pastExpiry = new Date(Date.now() - 60_000).toISOString();

test("categoriza status do Pix corretamente", () => {
  assert.equal(
    categorizePixStatus({ status: "CONCLUIDA", expiresAt: pastExpiry }),
    "paid",
  );
  assert.equal(
    categorizePixStatus({ status: "ATIVA", expiresAt: futureExpiry }),
    "pending",
  );
  assert.equal(
    categorizePixStatus({ status: "REMOVIDA_PELO_PSP", expiresAt: futureExpiry }),
    "failed",
  );
  assert.equal(
    categorizePixStatus({
      status: "REMOVIDA_PELO_USUARIO_RECEBEDOR",
      expiresAt: futureExpiry,
    }),
    "failed",
  );
});

test("categoriza Pix ATIVA vencida como failed (a API Pix não tem status de expiração)", () => {
  assert.equal(
    categorizePixStatus({ status: "ATIVA", expiresAt: pastExpiry }),
    "failed",
  );
});

test("categoriza status do boleto corretamente", () => {
  assert.equal(categorizeBoletoStatus("MARCADO_RECEBIDO"), "paid");
  assert.equal(categorizeBoletoStatus("A_RECEBER"), "pending");
  assert.equal(categorizeBoletoStatus("ATRASADO"), "pending");
  assert.equal(categorizeBoletoStatus("CANCELADO"), "failed");
  assert.equal(categorizeBoletoStatus("EXPIRADO"), "failed");
});

test("categoriza status de cartão do PagBank corretamente", () => {
  assert.equal(categorizeCardStatus("PAID"), "paid");
  assert.equal(categorizeCardStatus("AUTHORIZED"), "paid");
  assert.equal(categorizeCardStatus("IN_ANALYSIS"), "pending");
  assert.equal(categorizeCardStatus("DECLINED"), "failed");
  assert.equal(categorizeCardStatus("CANCELED"), "failed");
});

test("reconcilePaymentReference não faz nada quando o pedido não é encontrado", async () => {
  const deps = {
    findOrder: async () => null,
    markPaid: async () => {
      throw new Error("não deveria chamar");
    },
    markFailed: async () => {
      throw new Error("não deveria chamar");
    },
  };

  const result = await reconcilePaymentReference("inter", "TX1", "paid", deps);
  assert.equal(result.order, null);
});

test("reconcilePaymentReference marca como pago quando categoria é paid", async () => {
  const order = { id: 1, status: "pending", total: "10", currency: "BRL", metaData: {} };
  let markPaidCalls = 0;
  const deps = {
    findOrder: async () => order,
    markPaid: async (o, ref) => {
      markPaidCalls += 1;
      assert.equal(ref.externalId, "TX1");
      return { ...o, status: "processing" };
    },
    markFailed: async () => {
      throw new Error("não deveria chamar");
    },
  };

  const result = await reconcilePaymentReference("inter", "TX1", "paid", deps);
  assert.equal(markPaidCalls, 1);
  assert.equal(result.order.status, "processing");
});

test("reconcilePaymentReference marca como falho quando categoria é failed", async () => {
  const order = { id: 1, status: "pending", total: "10", currency: "BRL", metaData: {} };
  const deps = {
    findOrder: async () => order,
    markPaid: async () => {
      throw new Error("não deveria chamar");
    },
    markFailed: async (o) => ({ ...o, status: "failed" }),
  };

  const result = await reconcilePaymentReference("inter", "TX1", "failed", deps);
  assert.equal(result.order.status, "failed");
});

test("reconcilePaymentReference não escreve nada quando categoria é pending", async () => {
  const order = { id: 1, status: "pending", total: "10", currency: "BRL", metaData: {} };
  const deps = {
    findOrder: async () => order,
    markPaid: async () => {
      throw new Error("não deveria chamar");
    },
    markFailed: async () => {
      throw new Error("não deveria chamar");
    },
  };

  const result = await reconcilePaymentReference("inter", "TX1", "pending", deps);
  assert.equal(result.order.status, "pending");
});
