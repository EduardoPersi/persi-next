import {
  ACCOUNT_BODY_LIMIT_BYTES,
  AccountValidationError,
} from "./validation.ts";

export type RegisterPayload = {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  password: string;
  passwordConfirmation: string;
  acceptTerms: true;
};
export const RECOVERY_MESSAGE = "Se existir uma conta com este e-mail, enviaremos as instruções.";

function invalid(code: string): never {
  throw new AccountValidationError("Invalid account data", code);
}

function object(
  raw: string,
  allowed: string[],
  required = allowed,
  invalidCode = "ACCOUNT_PAYLOAD_INVALID",
) {
  if (Buffer.byteLength(raw, "utf8") > ACCOUNT_BODY_LIMIT_BYTES) {
    invalid(invalidCode);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid(invalidCode);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(invalidCode);
  }

  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  ) {
    invalid(invalidCode);
  }

  return value as Record<string, unknown>;
}

export function parseRegisterPayload(raw: string): RegisterPayload {
  const value = object(
    raw,
    [
      "name",
      "email",
      "phone",
      "cpf",
      "password",
      "passwordConfirmation",
      "acceptTerms",
    ],
    ["name", "email", "password", "passwordConfirmation", "acceptTerms"],
    "ACCOUNT_REGISTER_PAYLOAD_INVALID",
  );
  const phone = value.phone ?? "";
  const cpf = value.cpf ?? "";

  if (typeof value.name !== "string" || value.name.trim().length < 3) {
    invalid("ACCOUNT_REGISTER_PAYLOAD_INVALID");
  }
  if (
    typeof value.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())
  ) {
    invalid("ACCOUNT_REGISTER_PAYLOAD_INVALID");
  }
  if (
    typeof phone !== "string" ||
    !/^[\d\s()+.-]*$/.test(phone) ||
    (phone.replace(/\D/g, "").length !== 0 &&
      ![10, 11].includes(phone.replace(/\D/g, "").length))
  ) {
    invalid("ACCOUNT_REGISTER_PHONE_INVALID");
  }
  if (typeof cpf !== "string") {
    invalid("ACCOUNT_REGISTER_CPF_FIELD_MISSING");
  }
  if (typeof value.password !== "string" || value.password.length < 8) {
    invalid("ACCOUNT_REGISTER_PASSWORD_INVALID");
  }
  if (
    typeof value.passwordConfirmation !== "string" ||
    value.password !== value.passwordConfirmation
  ) {
    invalid("ACCOUNT_REGISTER_PASSWORD_MISMATCH");
  }
  if (value.acceptTerms !== true) {
    invalid("ACCOUNT_REGISTER_TERMS_REQUIRED");
  }

  return {
    name: value.name.trim(),
    email: value.email.trim().toLowerCase(),
    phone: phone.replace(/\D/g, ""),
    cpf: cpf.trim(),
    password: value.password,
    passwordConfirmation: value.password,
    acceptTerms: true,
  };
}
export function parseForgotPayload(raw: string) {
  const value = object(raw, ["email"]);
  if (typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) throw new AccountValidationError();
  return { email: value.email.trim().toLowerCase() };
}
export function parseResetPayload(raw: string) {
  const value = object(raw, ["login","key","password","passwordConfirmation"]);
  if (typeof value.login !== "string" || !value.login.trim() || typeof value.key !== "string" || !value.key.trim() || typeof value.password !== "string" || value.password.length < 8 || value.password !== value.passwordConfirmation) throw new AccountValidationError();
  return { login: value.login.trim(), key: value.key.trim(), password: value.password, passwordConfirmation: value.password };
}
