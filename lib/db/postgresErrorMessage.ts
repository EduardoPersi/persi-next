import "server-only";

// Gate 3 staging smoke test (2026-09-23) found that mapCartError/
// mapCheckoutError never recognized a REAL Postgres RAISE (only the
// synthetic errors used by unit-test mocks): drizzle-orm wraps the actual
// Postgres error inside `.cause` (drizzle-orm/errors.js's
// DrizzleQueryError), so `error.message` on the outer error is always the
// generic "Failed query: ..." string, not the RAISE's own message. This
// exact pattern already existed, independently, in
// app/api/checkout/native/route.ts's safePostgresMessage and in every
// services/payments/*/nativeAdapter.ts claim-gate -- centralized here so
// the two Gate 3 cart/checkout handler modules stop duplicating (and, as
// happened here, drifting from) it.
//
// Falls back to `error.message` when there is no `.cause` -- this is what
// keeps every existing unit test (which mocks a dependency with a plain
// `throw new Error("SOME_CODE")`, no `.cause`) working unchanged.
export function extractPostgresErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return error.message || "";
}

// The Postgres SQLSTATE (e.g. "23514"), when the underlying driver error
// carries one -- used only for the unexpected-error log line (Section 9 of
// docs/native-commerce/gate3-native-cart-checkout-routes.md: "never a raw
// Postgres error message", but the 5-character SQLSTATE code alone is not
// message text and carries no PII).
export function extractPostgresErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause && typeof cause === "object" && "code" in cause && typeof (cause as { code: unknown }).code === "string") {
      return (cause as { code: string }).code;
    }
    return error.name;
  }
  return "UNKNOWN";
}
