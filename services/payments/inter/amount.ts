/** Valor devolvido pelo Inter como texto ou número; `undefined` se não vier ou não for um número. */
export function parseInterAmount(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

/** `{ amount }` quando o Inter trouxe o valor; `{}` quando não trouxe (assim o campo some do objeto, não vira `undefined`). */
export function amountField(value: unknown): { amount?: number } {
  const amount = parseInterAmount(value);
  return amount === undefined ? {} : { amount };
}
