export interface QuantityLimits {
  minimum: number;
  maximum: number;
  step: number;
}

export type QuantityStepResult =
  | { action: "update"; quantity: number }
  | { action: "remove" }
  | { action: "none" };

export type TypedQuantityResult =
  | { action: "update"; quantity: number; notice?: string }
  | { action: "remove" }
  | { action: "none" };

// Limites do item no WooCommerce: mínimo 1, máximo 999 quando não informado,
// passo (múltiplo de venda) 1.
export function getQuantityLimits(item: {
  minQuantity: number;
  maxQuantity?: number;
  quantityStep: number;
}): QuantityLimits {
  const minimum = Math.max(1, item.minQuantity);
  return {
    minimum,
    maximum: Math.max(minimum, item.maxQuantity ?? 999),
    step: Math.max(1, item.quantityStep),
  };
}

// Próxima quantidade ao tocar em "−" ou "+". Descer abaixo do mínimo
// (quantidade 0) pede a remoção do item; subir além do máximo não faz nada.
export function stepQuantity(
  current: number,
  direction: "decrease" | "increase",
  { minimum, maximum, step }: QuantityLimits,
): QuantityStepResult {
  if (direction === "increase") {
    const next = current + step;
    return next > maximum ? { action: "none" } : { action: "update", quantity: next };
  }
  const next = current - step;
  return next < minimum ? { action: "remove" } : { action: "update", quantity: next };
}

export function canIncreaseQuantity(current: number, limits: QuantityLimits) {
  return stepQuantity(current, "increase", limits).action === "update";
}

// Valor digitado no campo (aplicado ao sair do campo ou com Enter). Só conta
// dígitos; arredonda para o múltiplo de venda mais próximo (a partir do mínimo)
// e limita ao mínimo e ao máximo/estoque, devolvendo o aviso do ajuste.
//   zero: "remove"  → digitar 0 pede a remoção (carrinho e checkout);
//   zero: "minimum" → digitar 0 vira o mínimo (página de produto, antes de comprar).
export function resolveTypedQuantity(
  raw: string,
  { minimum, maximum, step }: QuantityLimits,
  { zero }: { zero: "remove" | "minimum" },
): TypedQuantityResult {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { action: "none" };
  const typed = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(typed)) {
    return {
      action: "update",
      quantity: maximumAligned(minimum, maximum, step),
      notice: maximumNotice(minimum, maximum, step),
    };
  }

  if (typed === 0 && zero === "remove") return { action: "remove" };
  if (typed < minimum) {
    return {
      action: "update",
      quantity: minimum,
      notice: `Ajustamos para ${minimum}, a quantidade mínima.`,
    };
  }

  const aligned = minimum + Math.round((typed - minimum) / step) * step;
  if (aligned > maximum) {
    return {
      action: "update",
      quantity: maximumAligned(minimum, maximum, step),
      notice: maximumNotice(minimum, maximum, step),
    };
  }
  if (aligned !== typed) {
    return {
      action: "update",
      quantity: aligned,
      notice: `Ajustamos para ${aligned}, múltiplo de ${step}.`,
    };
  }
  return { action: "update", quantity: typed };
}

function maximumAligned(minimum: number, maximum: number, step: number) {
  return minimum + Math.floor((maximum - minimum) / step) * step;
}

function maximumNotice(minimum: number, maximum: number, step: number) {
  return `Ajustamos para ${maximumAligned(minimum, maximum, step)}, o máximo disponível.`;
}
