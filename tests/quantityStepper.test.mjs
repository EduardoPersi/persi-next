import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canIncreaseQuantity,
  getQuantityLimits,
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

test("o controle usa as ações existentes do carrinho, trava durante a atualização e confirma a remoção", () => {
  const source = read("components/UI/QuantityStepper.tsx");

  // Mesmas ações do carrinho: nenhum cálculo de total novo.
  assert.match(source, /updateItem\(item\.key, next\.quantity\)/);
  assert.match(source, /removeItem\(item\.key\)/);
  assert.doesNotMatch(source, /fetch\(/);
  // Botões travados enquanto há atualização em andamento.
  assert.match(source, /isCheckoutUpdating \|\| isLoading \|\| pendingItemKey !== null/);
  assert.match(source, /disabled=\{isBusy\}/);
  // Confirmação antes de remover e volta ao carrinho quando esvazia.
  assert.ok(source.includes("Remover este item?"));
  assert.ok(source.includes('navigate("/carrinho")'));
  // Ajuste de estoque devolvido pelo servidor é informado ao cliente.
  assert.ok(source.includes("A quantidade foi ajustada conforme o estoque disponível."));
});
