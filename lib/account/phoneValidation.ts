const VALID_BRAZILIAN_AREA_CODES = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24",
  "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46",
  "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64",
  "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

export type BrazilianPhoneError =
  | "DDD inválido."
  | "Informe um telefone válido.";

export function getPhoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function formatBrazilianPhone(value: string): string {
  const digits = getPhoneDigits(value);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;

  const areaCode = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  if (subscriber.length <= 4) return `(${areaCode}) ${subscriber}`;

  const prefixLength = digits.length === 11 ? 5 : 4;
  return `(${areaCode}) ${subscriber.slice(0, prefixLength)}-${subscriber.slice(prefixLength)}`;
}

export function validateBrazilianPhone(
  value: string,
): BrazilianPhoneError | null {
  const digits = getPhoneDigits(value);
  if (digits.length === 0) return null;
  if (digits.length !== 10 && digits.length !== 11) {
    return "Informe um telefone válido.";
  }

  const areaCode = digits.slice(0, 2);
  if (!VALID_BRAZILIAN_AREA_CODES.has(areaCode)) {
    return "DDD inválido.";
  }

  const subscriber = digits.slice(2);
  if (/^(\d)\1+$/.test(subscriber)) {
    return "Informe um telefone válido.";
  }

  const validFixedLine = digits.length === 10 && /^[2-5]/.test(subscriber);
  const validMobile = digits.length === 11 && subscriber.startsWith("9");
  return validFixedLine || validMobile
    ? null
    : "Informe um telefone válido.";
}
