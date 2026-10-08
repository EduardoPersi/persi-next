export interface QuantityLimits {
  minimum: number;
  maximum: number;
  step: number;
}

export type QuantityStepResult =
  | { action: "update"; quantity: number }
  | { action: "remove" }
  | { action: "none" };

// Limites do item no WooCommerce, com os mesmos valores padrão do seletor
// (QuantitySelect): mínimo 1, máximo 999 quando não informado, passo 1.
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
