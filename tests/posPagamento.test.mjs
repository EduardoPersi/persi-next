import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyCartItems } from "../services/woocommerce/cartEmpty.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

// ---------- esvaziar o carrinho depois do pedido ----------
const carrinho = (...keys) => ({ cart: { items: keys.map((key) => ({ key })) } });

test("esvazia todos os itens do carrinho e devolve a contagem", async () => {
  const removidos = [];
  const resultado = await emptyCartItems("token-do-carrinho", {
    getCart: async () => carrinho("a", "b", "c"),
    removeItem: async (key, token) => {
      removidos.push([key, token]);
    },
  });
  assert.deepEqual(resultado, { removed: 3, failed: 0 });
  assert.deepEqual(removidos, [
    ["a", "token-do-carrinho"],
    ["b", "token-do-carrinho"],
    ["c", "token-do-carrinho"],
  ]);
});

test("carrinho já vazio ou sem token não chama nada de remoção", async () => {
  let remocoes = 0;
  const deps = {
    getCart: async () => carrinho(),
    removeItem: async () => {
      remocoes += 1;
    },
  };
  assert.deepEqual(await emptyCartItems("t", deps), { removed: 0, failed: 0 });
  assert.deepEqual(await emptyCartItems(undefined, deps), { removed: 0, failed: 0 });
  assert.equal(remocoes, 0);
});

test("falha ao remover ou ao ler o carrinho nunca lança: o pagamento vale mais que a limpeza", async () => {
  const tentativas = [];
  const parcial = await emptyCartItems("t", {
    getCart: async () => carrinho("a", "b", "c"),
    removeItem: async (key) => {
      tentativas.push(key);
      if (key === "b") throw new Error("WooCommerce fora do ar");
    },
  });
  assert.deepEqual(parcial, { removed: 2, failed: 1 });
  assert.deepEqual(tentativas, ["a", "b", "c"], "um item com erro não impede os outros");

  const semLeitura = await emptyCartItems("t", {
    getCart: async () => {
      throw new Error("sem resposta");
    },
    removeItem: async () => {
      throw new Error("não deveria chamar");
    },
  });
  assert.deepEqual(semLeitura, { removed: 0, failed: 1 });
});

// ---------- a rota de pagamento ----------
test("rota: o carrinho é esvaziado nos sucessos (inclusive repetição da mesma chave) e nunca na recusa", () => {
  const route = read("app/api/checkout/payment/route.ts");
  // Três saídas de sucesso: as duas repetições de "já iniciado" e o resultado final.
  assert.equal(route.split("await emptyCartAfterOrder(activeCartToken);").length - 1, 3);
  const final = route.indexOf("await emptyCartAfterOrder(activeCartToken);\n    return createPrivateResponse(result, 201, activeCartToken);");
  assert.ok(final > -1);
  // Só os ITENS saem: o token do carrinho fica (autoriza a consulta do pedido e gera a sessão).
  assert.ok(!route.includes("clearCartToken: true"));
  assert.ok(route.includes("emptyCartItems(cartToken, { getCart, removeItem: removeCartItem })"));
  // A recusa de cartão devolve ANTES de esvaziar: o cliente continua com o carrinho para tentar de novo.
  for (const parte of route.split("return createCardDeclinedResponse(order.id, charge.chargeId")) {
    void parte;
  }
  const primeiraRecusa = route.indexOf("return createCardDeclinedResponse(order.id, charge.chargeId");
  assert.ok(primeiraRecusa > -1 && primeiraRecusa < final);
  const trechoDaRecusa = route.slice(primeiraRecusa - 400, primeiraRecusa + 120);
  assert.ok(!trechoDaRecusa.includes("emptyCartAfterOrder"));
});

test("rota: cartão aprovado na hora vira pedido pago agora, pelo caminho do webhook, e nunca quebra o pagamento", () => {
  const route = read("app/api/checkout/payment/route.ts");
  assert.ok(route.includes('await reconcilePaymentReference(provider, chargeId, "paid");'));
  // Os dois ramos de cartão disparam depois da recusa e antes do resultado.
  for (const provedor of ["mercadopago", "pagbank"]) {
    const reconciliacao = route.indexOf(`await reconcileApprovedCard("${provedor}", charge.chargeId, order);`);
    const resultado = route.indexOf("result = {", reconciliacao);
    assert.ok(reconciliacao > -1 && resultado > reconciliacao);
  }
  // A função engole o erro (log sem dado pessoal): o cliente nunca vê falha por causa disto.
  const inicio = route.indexOf("async function reconcileApprovedCard(");
  const funcao = route.slice(inicio, route.indexOf("function requireCompleteAddress(", inicio));
  assert.ok(funcao.includes("try {") && funcao.includes("} catch (error) {"));
  assert.ok(!/email|phone|telefone|document/i.test(funcao));
});

test("página de confirmação: o aprovado também é reconciliado, depois da conferência (idempotente)", () => {
  const page = read("app/checkout/confirmacao/page.tsx");
  assert.ok(page.includes('await reconcilePaymentReference("mercadopago", reference, "paid");'));
  assert.ok(page.includes('await reconcilePaymentReference("mercadopago", attempt.provider_reference, "paid");'));
  assert.ok(page.includes('await reconcilePaymentReference("pagbank", attempt.provider_reference, "paid");'));
});

test("checkout: depois do pedido criado, o carrinho que o site tem na tela é atualizado", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const inicio = form.indexOf("const markOrderCreated = () => {");
  const bloco = form.slice(inicio, form.indexOf("};", inicio));
  assert.ok(bloco.includes("setHasCreatedOrder();"));
  assert.ok(bloco.includes("void refreshCart();"));
  // A marca de "pedido criado" vem antes: sem ela, o carrinho vazio trocaria a tela do pedido.
  assert.ok(bloco.indexOf("setHasCreatedOrder();") < bloco.indexOf("void refreshCart();"));
});
