export const CHECKOUT_AUTH_BODY_LIMIT_BYTES = 8 * 1024;

export type CheckoutIdentityAction =
  | "identify"
  | "password"
  | "code-request"
  | "code-verify";

export interface CheckoutIdentityPayload {
  email: string;
  password?: string;
  code?: string;
}

export class CheckoutIdentityValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCheckoutEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function maskCheckoutEmail(email: string): string {
  const [local = "", domain = ""] = normalizeCheckoutEmail(email).split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export function parseCheckoutIdentityPayload(
  rawBody: string,
  action: CheckoutIdentityAction,
): CheckoutIdentityPayload {
  if (Buffer.byteLength(rawBody, "utf8") > CHECKOUT_AUTH_BODY_LIMIT_BYTES) {
    throw new CheckoutIdentityValidationError("Payload muito grande.");
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new CheckoutIdentityValidationError("Dados inválidos.");
  }
  if (!isRecord(value)) throw new CheckoutIdentityValidationError("Dados inválidos.");

  const allowed = action === "password"
    ? ["email", "password"]
    : action === "code-verify"
      ? ["code", "email"]
      : ["email"];
  if (Object.keys(value).sort().join(",") !== allowed.sort().join(",")) {
    throw new CheckoutIdentityValidationError("Dados inválidos.");
  }

  const email = typeof value.email === "string"
    ? normalizeCheckoutEmail(value.email)
    : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CheckoutIdentityValidationError("Informe um e-mail válido.");
  }

  if (action === "password") {
    if (typeof value.password !== "string" || value.password.length < 1 || value.password.length > 4096) {
      throw new CheckoutIdentityValidationError("Informe sua senha.");
    }
    return { email, password: value.password };
  }

  if (action === "code-verify") {
    if (typeof value.code !== "string" || !/^\d{6}$/.test(value.code)) {
      throw new CheckoutIdentityValidationError("Informe os seis dígitos do código.");
    }
    return { email, code: value.code };
  }

  return { email };
}
