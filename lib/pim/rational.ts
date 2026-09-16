// A3.5E-P2-H-R2A: canonical, deterministic decimal-text -> exact-rational
// conversion. Root cause of the H-R1 rollback (PostgresError "invalid
// input syntax for type bigint: 0.625"): `attribute_values.measurement_numerator`
// and `measurement_denominator` are BIGINT (supabase/migrations/
// 20260823110200_pim.sql, lines 45-70), and the schema's own sibling table
// `measurement_components` independently confirms the intended contract is
// a non-negative integer/integer rational (numerator bigint, denominator
// bigint check > 0) — never a float. The old code path
// (lib/pim/normalization.ts's parseSide) did `Number("0,625".replace(",","."))`
// and assigned the resulting JS float DIRECTLY as `numerator` with
// `denominator: 1`, which is both semantically wrong (0.625 is not an
// integer numerator over 1) and, for any non-integer value, physically
// impossible to store in a bigint column.
//
// This module converts the ALREADY-normalized decimal TEXT (never a
// float) into an exact, fully-reduced integer numerator/denominator pair,
// using BigInt arithmetic throughout — no `Number()`/float step ever
// touches the fractional value, so no binary floating-point rounding can
// be introduced (Section 6's explicit requirement).

export type ExactRational = { numerator: number; denominator: number };

// Postgres bigint range is -2^63..2^63-1, but the practical, enforced
// safety boundary here is JS's own safe-integer range (2^53-1) since the
// public field type is `number`, not `bigint` (matching the existing
// MeasurementComponent type in normalization.ts) — any real commercial
// measurement is many orders of magnitude below this, so the guard only
// ever fires on a genuinely malformed/adversarial input.
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// tsconfig.json targets ES2017, where BigInt literal syntax (0n, 1n, ...)
// is rejected by the compiler (TS2737) even though BigInt itself is a
// runtime-supported global — so every literal below is built via
// `BigInt(0)` etc. instead, with identical semantics.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < ZERO ? -a : a;
  let y = b < ZERO ? -b : b;
  while (y !== ZERO) { [x, y] = [y, x % y]; }
  return x === ZERO ? ONE : x;
}

// Accepts exactly the shape normalization.ts's own regex already produces
// for a plain (non-fraction) side: an optional leading "-", one or more
// digits, and an optional single "." or "," followed by one or more
// digits — e.g. "0,625", "3.6", "625", "-1,5", "1,50", "0.000". Rejects
// anything else (multiple separators, empty string, non-digit content)
// deterministically rather than silently coercing it.
const DECIMAL_TEXT_PATTERN = /^(-)?(\d+)(?:[.,](\d+))?$/;

export function exactRationalFromDecimalText(text: string): ExactRational {
  const match = DECIMAL_TEXT_PATTERN.exec(text.trim());
  if (!match) throw new Error(`exactRationalFromDecimalText: invalid decimal text "${text}"`);
  const [, signPart, wholeDigitsRaw, fractionDigitsRaw] = match;
  const negative = signPart === "-";

  const wholeDigits = wholeDigitsRaw.replace(/^0+(?=\d)/, "");
  const fractionDigits = (fractionDigitsRaw ?? "").replace(/0+$/, "");

  if (fractionDigits === "") {
    const whole = BigInt(wholeDigits);
    if (whole > MAX_SAFE) throw new Error(`exactRationalFromDecimalText: overflow for "${text}"`);
    const numerator = whole === ZERO ? 0 : Number(negative ? -whole : whole);
    return { numerator, denominator: 1 };
  }

  const scale = fractionDigits.length;
  const combined = BigInt(`${wholeDigits}${fractionDigits}`);
  const denominatorRaw = TEN ** BigInt(scale);
  const divisor = gcdBig(combined, denominatorRaw);
  const reducedNumerator = combined / divisor;
  const reducedDenominator = denominatorRaw / divisor;

  if (reducedNumerator > MAX_SAFE || reducedDenominator > MAX_SAFE) {
    throw new Error(`exactRationalFromDecimalText: overflow for "${text}"`);
  }

  const numerator = reducedNumerator === ZERO ? 0 : Number(negative ? -reducedNumerator : reducedNumerator);
  return { numerator, denominator: Number(reducedDenominator) };
}

// A3.5E-P2-J, Section 25: the database stores the EXACT rational
// representation (numerator/denominator/unit) forever -- this function is
// the one and only place that turns it into a pt-BR customer-friendly
// decimal string for DISPLAY (e.g. 5/8 m -> "0,625 m"). It never runs the
// other direction and never changes what is persisted. Every denominator
// this pipeline ever produces (from exactRationalFromDecimalText above,
// always built from a finite decimal pt-BR/en text with a handful of
// fractional digits) is of the form 2^a * 5^b, so its decimal expansion
// always terminates -- there is no rational value this catalog persists
// that needs rounding here. `maxDecimals` is a defensive cap, not a
// rounding strategy: if a future denominator ever needed more digits than
// that to terminate exactly, this throws rather than silently emitting a
// rounded (and therefore no longer exact) display string.
export function formatRationalForDisplay(numerator: number, denominator: number, unit: string, maxDecimals = 6): string {
  if (denominator <= 0) throw new Error(`formatRationalForDisplay: invalid denominator ${denominator}`);
  const negative = numerator < 0;
  const n = BigInt(Math.abs(numerator));
  const d = BigInt(denominator);
  const whole = n / d;
  let remainder = n % d;
  if (remainder === ZERO) return `${negative ? "-" : ""}${whole} ${unit}`;
  const digits: string[] = [];
  for (let i = 0; i < maxDecimals && remainder !== ZERO; i++) {
    remainder *= TEN;
    digits.push((remainder / d).toString());
    remainder %= d;
  }
  if (remainder !== ZERO) throw new Error(`formatRationalForDisplay: ${numerator}/${denominator} does not terminate within ${maxDecimals} decimal places -- refusing to round`);
  return `${negative ? "-" : ""}${whole},${digits.join("")} ${unit}`;
}
