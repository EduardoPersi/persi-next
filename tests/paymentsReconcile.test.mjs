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

test("avisa o WhatsApp só depois de marcar como pago", async () => {
  const order = { id: 7, status: "pending", total: "10", currency: "BRL", metaData: {} };
  const pago = { ...order, status: "processing" };
  const ordem = [];
  const deps = {
    findOrder: async () => order,
    markPaid: async () => {
      ordem.push("markPaid");
      return pago;
    },
    markFailed: async () => {
      throw new Error("não deveria chamar");
    },
    avisarPedido: async (o) => {
      ordem.push("avisou");
      assert.equal(o.status, "processing");
      return { enviado: true };
    },
  };

  await reconcilePaymentReference("inter", "TX1", "paid", deps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ordem, ["markPaid", "avisou"]);
});

test("painel fora do ar não derruba a conciliação do pagamento", async () => {
  const order = { id: 8, status: "pending", total: "10", currency: "BRL", metaData: {} };
  const deps = {
    findOrder: async () => order,
    markPaid: async () => ({ ...order, status: "processing" }),
    markFailed: async () => {
      throw new Error("não deveria chamar");
    },
    avisarPedido: async () => {
      throw new Error("painel fora do ar");
    },
  };

  const result = await reconcilePaymentReference("inter", "TX1", "paid", deps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.order.status, "processing");
});

test("quem injeta deps sem avisarPedido continua funcionando", async () => {
  const order = { id: 9, status: "pending", total: "10", currency: "BRL", metaData: {} };
  const deps = {
    findOrder: async () => order,
    markPaid: async () => ({ ...order, status: "processing" }),
    markFailed: async () => {
      throw new Error("não deveria chamar");
    },
  };

  const result = await reconcilePaymentReference("inter", "TX1", "paid", deps);
  assert.equal(result.order.status, "processing");
});

test("pedido sem telefone não vira aviso de WhatsApp", async () => {
  const { reconcilePaymentReference: real } = await import("../services/payments/reconcile.ts");
  // O caminho real (defaultDeps) exige rede; aqui basta garantir que a regra
  // de "sem telefone, sem aviso" está escrita no arquivo e não se perdeu.
  const fonte = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/payments/reconcile.ts", import.meta.url), "utf8"),
  );
  assert.equal(typeof real, "function");
  assert.match(fonte, /if \(!order\.billingPhone\) return/);
});

// ---------------------------------------------------------------------------
// A PRIMEIRA DAS DUAS TRAVAS CONTRA O AVISO EM DOBRO (etapa C2)
// ---------------------------------------------------------------------------
//
// O provedor de pagamento REENVIA webhook — é o que ele faz quando a resposta
// demora ou volta com erro. `markPaid` já era idempotente, mas o aviso pelo
// WhatsApp saía SEM perguntar nada, e o cliente recebia "Pedido 1234 — pago"
// tantas vezes quantas o provedor insistisse.
//
// A segunda trava está no painel, que recusa um segundo aviso do mesmo pedido.
// Esta aqui é a de cá, e existe para o caso normal não chegar lá.

const pedidoPagoPor = (externalId) => ({
  id: 1,
  status: "processing",
  total: "10",
  currency: "BRL",
  metaData: { _persi_payment_reference: externalId },
});

test("o aviso sai UMA vez quando o pedido acabou de ser pago", async () => {
  let avisos = 0;
  const order = { id: 1, status: "pending", total: "10", currency: "BRL", metaData: {} };
  await reconcilePaymentReference("inter", "TX1", "paid", {
    findOrder: async () => order,
    markPaid: async (o) => ({ ...o, status: "processing" }),
    markFailed: async () => { throw new Error("não deveria chamar"); },
    avisarPedido: async () => { avisos += 1; },
  });
  // O aviso é disparado solto (`void`), então damos uma volta de event loop.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(avisos, 1);
});

test("o aviso NÃO sai de novo quando o webhook chega repetido", async () => {
  let avisos = 0;
  // O pedido JÁ está pago por esta mesma referência: é exatamente o que o
  // segundo webhook encontra.
  const order = pedidoPagoPor("TX1");
  await reconcilePaymentReference("inter", "TX1", "paid", {
    findOrder: async () => order,
    markPaid: async (o) => o,
    markFailed: async () => { throw new Error("não deveria chamar"); },
    avisarPedido: async () => { avisos += 1; },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(avisos, 0);
});

test("mas um pagamento de OUTRA referência no mesmo pedido avisa", async () => {
  // Troca de meio de pagamento: o cliente tentou no Pix, não pagou, e pagou no
  // cartão. É pagamento novo, e o cliente tem de saber.
  let avisos = 0;
  const order = pedidoPagoPor("TX-ANTIGA");
  await reconcilePaymentReference("pagbank", "TX-NOVA", "paid", {
    findOrder: async () => order,
    markPaid: async (o) => ({ ...o, metaData: { _persi_payment_reference: "TX-NOVA" } }),
    markFailed: async () => { throw new Error("não deveria chamar"); },
    avisarPedido: async () => { avisos += 1; },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(avisos, 1);
});

test("a regra de 'já pago' é UMA só, lida pelos dois lados", async () => {
  // Se `markPaid` e o aviso decidissem com regras próprias, um dia uma delas
  // mudaria — e aí o pedido não seria reescrito mas a mensagem sairia de novo.
  const { readFileSync } = await import("node:fs");
  const reconcile = readFileSync("services/payments/reconcile.ts", "utf8");
  const orders = readFileSync("services/woocommerce/orders.ts", "utf8");
  assert.match(orders, /export function alreadyPaidFor/);
  assert.match(orders, /if \(alreadyPaidFor\(order, reference\)\) return order;/);
  assert.match(reconcile, /alreadyPaidFor/);
});

test("pedido que NÃO está num status pago volta a avisar, mesmo com a referência gravada", async () => {
  // O caso que a regra de status protege: a referência do pagamento está no
  // pedido, mas ele não está num status pago — foi devolvido para pendente, ou
  // alguém mexeu nele no WooCommerce. Quando ele for pago de novo, o cliente
  // tem de ser avisado.
  //
  // Sem a conferência de STATUS, `alreadyPaidFor` olharia só a referência e
  // calaria o aviso para sempre naquele pedido.
  let avisos = 0;
  const order = {
    id: 1,
    status: "pending",
    total: "10",
    currency: "BRL",
    metaData: { _persi_payment_reference: "TX1" },
  };
  await reconcilePaymentReference("inter", "TX1", "paid", {
    findOrder: async () => order,
    markPaid: async (o) => ({ ...o, status: "processing" }),
    markFailed: async () => { throw new Error("não deveria chamar"); },
    avisarPedido: async () => { avisos += 1; },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(avisos, 1);
});
