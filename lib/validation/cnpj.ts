function calculateCnpjCheckDigit(base: string, weights: number[]): number {
  let total = 0;
  for (let index = 0; index < weights.length; index += 1) {
    total += Number(base[index]) * weights[index];
  }
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

const FIRST_CHECK_DIGIT_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_CHECK_DIGIT_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function isValidBrazilianCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const firstCheckDigit = calculateCnpjCheckDigit(
    digits.slice(0, 12),
    FIRST_CHECK_DIGIT_WEIGHTS,
  );
  const secondCheckDigit = calculateCnpjCheckDigit(
    digits.slice(0, 13),
    SECOND_CHECK_DIGIT_WEIGHTS,
  );

  return (
    firstCheckDigit === Number(digits[12]) &&
    secondCheckDigit === Number(digits[13])
  );
}
