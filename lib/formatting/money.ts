import type { CartMoney } from "@/types/cart";

export function formatStoreMoney(
  money: CartMoney,
  locale = "pt-BR",
): string {
  const minorUnit = Math.max(0, money.currencyMinorUnit);
  const normalized = /^-?\d+$/.test(money.value) ? money.value : "0";
  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  const padded = digits.padStart(minorUnit + 1, "0");
  const majorDigits =
    minorUnit === 0 ? padded : padded.slice(0, -minorUnit);
  const fraction =
    minorUnit === 0 ? "" : padded.slice(-minorUnit);
  const major = BigInt(majorDigits || "0");
  const formattedMajor = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(major);
  const amount = fraction
    ? `${formattedMajor},${fraction}`
    : formattedMajor;

  return `${negative ? "-" : ""}${money.currencySymbol} ${amount}`;
}

export function isZeroMoney(money: CartMoney): boolean {
  return /^-?0+$/.test(money.value);
}

export function moneyToNumber(money: CartMoney): number {
  if (!/^-?\d+$/.test(money.value)) return 0;
  return Number(money.value) / 10 ** Math.max(0, money.currencyMinorUnit);
}
