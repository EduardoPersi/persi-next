import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canIncreaseQuantity,
  getQuantityLimits,
  resolveTypedQuantity,
  stepQuantity,
} from "../components/UI/quantityStepping.ts";

const read = (path) => readFileSync(path, "utf8");
const free = { minimum: 1, maximum: 10, step: 1 };

test("+ sobe um passo e para no máximo (estoque)", () => {
  assert.deepEqual(stepQuantity(3, "increase", free), { action: "update", quantity: 4 });
  assert.deepEqual(stepQuantity(10, "increase", free), { action: "none" });
  assert.equal(canIncreaseQuantity(9, free), true);
  assert.equal(canIncreaseQuantity(10, free), false);
});

test("− desce um passo e, abaixo do mínimo, pede a remoção (quantidade 0)", () => {
  assert.deepEqual(stepQuantity(3, "decrease", free), { action: "update", quantity: 2 });
  assert.deepEqual(stepQuantity(1, "decrease", free), { action: "remove" });
});

test("respeita múltiplo de venda e mínimo maior que 1", () => {
  const boxes = { minimum: 5, maximum: 50, step: 5 };
  assert.deepEqual(stepQuantity(10, "increase", boxes), { action: "update", quantity: 15 });
  assert.deepEqual(stepQuantity(10, "decrease", boxes), { action: "update", quantity: 5 });
  assert.deepEqual(stepQuantity(5, "decrease", boxes), { action: "remove" });
  assert.deepEqual(stepQuantity(50, "increase", boxes), { action: "none" });
});

test("limites usam os mesmos padrões do seletor do carrinho", () => {
  assert.deepEqual(
    getQuantityLimits({ minQuantity: 0, maxQuantity: undefined, quantityStep: 0 }),
    { minimum: 1, maximum: 999, step: 1 },
  );
  assert.deepEqual(
    getQuantityLimits({ minQuantity: 5, maxQuantity: 3, quantityStep: 5 }),
    { minimum: 5, maximum: 5, step: 5 },
  );
});

test("digitar: arredonda para o múltiplo, limita ao estoque e avisa o ajuste", () => {
  const boxes = { minimum: 10, maximum: 200, step: 10 };
  assert.deepEqual(resolveTypedQuantity("120", boxes, { zero: "remove" }), {
    action: "update",
    quantity: 120,
  });
  const rounded = resolveTypedQuantity("124", boxes, { zero: "remove" });
  assert.equal(rounded.quantity, 120);
  assert.equal(rounded.notice, "Ajustamos para 120, múltiplo de 10.");
  const capped = resolveTypedQuantity("999", boxes, { zero: "remove" });
  assert.equal(capped.quantity, 200);
  assert.equal(capped.notice, "Ajustamos para 200, o máximo disponível.");
  const raised = resolveTypedQuantity("4", boxes, { zero: "remove" });
  assert.equal(raised.quantity, 10);
  assert.equal(raised.notice, "Ajustamos para 10, a quantidade mínima.");
  // Máximo que não é múltiplo: fica no maior múltiplo permitido.
  assert.equal(resolveTypedQuantity("999", { minimum: 10, maximum: 95, step: 10 }, { zero: "remove" }).quantity, 90);
});

test("digitar 0: remove no carrinho, vira o mínimo antes de comprar; vazio é ignorado", () => {
  assert.deepEqual(resolveTypedQuantity("0", free, { zero: "remove" }), { action: "remove" });
  const local = resolveTypedQuantity("0", free, { zero: "minimum" });
  assert.equal(local.action, "update");
  assert.equal(local.quantity, 1);
  assert.deepEqual(resolveTypedQuantity("", free, { zero: "remove" }), { action: "none" });
  assert.deepEqual(resolveTypedQuantity("abc", free, { zero: "remove" }), { action: "none" });
  assert.equal(resolveTypedQuantity("1a2", free, { zero: "remove" }).quantity, 10);
});

test("o controle usa as ações existentes do carrinho, trava durante a atualização e confirma a remoção", () => {
  const source = read("components/UI/QuantityStepper.tsx");

  // Mesmas ações do carrinho: nenhum cálculo de total novo.
  assert.ok(source.includes("updateItem(item.key, quantity)"));
  assert.ok(source.includes("removeItem(item.key)"));
  assert.ok(!source.includes("fetch("));
  // Botões travados enquanto há atualização em andamento.
  assert.ok(source.includes("isCheckoutUpdating || isLoading || pendingItemKey !== null"));
  assert.ok(source.includes("disabled={isBusy}"));
  // Confirmação antes de remover; no mínimo o "−" fica ativo para perguntar.
  assert.ok(source.includes("Remover este item?"));
  assert.ok(source.includes("canDecrease"));
  // Volta ao carrinho só quando quem usa pede (checkout), nunca no mini-carrinho.
  assert.ok(source.includes("emptyCartHref"));
  assert.ok(source.includes("navigate(emptyCartHref)"));
  // Ajuste de estoque devolvido pelo servidor é informado ao cliente.
  assert.ok(source.includes("conforme o estoque disponível."));
});

test("um único visual: cores originais do mini-carrinho, tamanho fixo, campo numérico e Enter/saída do campo", () => {
  const control = read("components/UI/QuantityControl.tsx");
  // Cores e hover originais do mini-carrinho: borda e fundo neutros, ícone escuro.
  assert.ok(control.includes("border border-slate-200 bg-white"));
  assert.ok(control.includes("text-foreground"));
  assert.ok(control.includes("hover:bg-slate-100 active:bg-slate-200"));
  assert.ok(control.includes("disabled:text-slate-300"));
  assert.ok(control.includes("focus:border-primary"));
  // Sem laranja na borda nem nos ícones.
  assert.ok(!control.includes("secondary"));
  // Tamanho compacto e fixo: 114 x 36 px, botões quadrados de 36 px.
  assert.ok(control.includes('md: "h-9 w-[114px] rounded-md"'));
  assert.ok(control.includes('md: "w-9"'));
  assert.ok(control.includes('"w-10"'));
  assert.ok(control.includes('inputMode="numeric"'));
  assert.ok(control.includes("onBlur={commit}"));
  assert.ok(control.includes('event.key === "Enter"'));
});

test("produto, visualização rápida e comprados juntos usam o mesmo controle, sem pergunta de remoção", () => {
  const product = read("components/Product/ProductQuantity.tsx");
  assert.ok(product.includes("<QuantityControl"));
  assert.ok(product.includes('zero: "minimum"'));
  assert.ok(product.includes("canDecrease={value > limits.minimum}"));
  assert.ok(!product.includes("Remover"));
  for (const path of [
    "components/Product/BuyTogether.tsx",
    "components/Product/FrequentlyBoughtTogether.tsx",
  ]) {
    const source = read(path);
    assert.ok(source.includes("<ProductQuantity"));
    assert.ok(!source.includes('type="number"'));
    assert.ok(!source.includes("Diminuir quantidade de"));
  }
});
