const MONEY_PATTERN = /^-?[0-9]+$/;

export function parseMoneyMinor(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!MONEY_PATTERN.test(value)) throw new Error("Valor monetário em minor units inválido.");
  return BigInt(value);
}

export function moneyMinorToString(value: bigint): string {
  return value.toString(10);
}

export function moneyMinorToSafeNumber(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Valor monetário excede o limite seguro de Number.");
  }
  return parsed;
}
