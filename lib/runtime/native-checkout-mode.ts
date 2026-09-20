import "server-only";

// B.3-I — native checkout feature flag foundation (Section 18). Minimal
// contract on purpose: NOT the PIM shadow/canary model (sample rates,
// membership rollout percentages, publication modes) — this round's own
// instruction is "determinar o menor contrato necessário", and nothing yet
// calls submitNativeCommerceCheckout from a route, so there is nothing for
// a richer flag to gate today. Extend this only when a real caller needs
// the extra knob, not preemptively.
//
// Fail-closed by construction: default, missing, unknown, and
// wrong-case/whitespace-only values all resolve to "off". There is no
// "unsafe" input that resolves to anything other than "off" except the two
// exact, lowercase, trimmed strings "shadow" and "canary".
export type NativeCheckoutMode = "off" | "shadow" | "canary";

const VALID_MODES: ReadonlySet<string> = new Set(["off", "shadow", "canary"]);

export function getNativeCheckoutMode(environment: NodeJS.ProcessEnv = process.env): NativeCheckoutMode {
  const raw = environment.NATIVE_CHECKOUT_MODE?.trim().toLowerCase();
  if (raw && VALID_MODES.has(raw)) return raw as NativeCheckoutMode;
  return "off";
}

// Section 31: regardless of NATIVE_CHECKOUT_MODE, no route in this round
// calls the native checkout service, so the flag has no live effect yet.
// This function exists so that whichever future route DOES read the flag
// has one unambiguous place to ask "am I allowed to run at all" — today it
// always returns false, on purpose, independent of the env value, because
// nothing has been reviewed/authorized for even shadow observation of a
// mutable flow yet (Section 19: shadow must never create a real order,
// reserve stock, create a payment attempt, or call a provider — this
// round's native checkout service does all four by design, so shadow mode
// for IT specifically is not safe and is intentionally not offered here).
export function isNativeCheckoutRuntimeEnabled(): boolean {
  return false;
}
