import { ACCOUNT_BODY_LIMIT_BYTES, AccountValidationError } from "./validation.ts";

export type RegisterPayload = { name: string; email: string; phone: string; cpf: string; password: string; passwordConfirmation: string; acceptTerms: true };
export const RECOVERY_MESSAGE = "Se existir uma conta com este e-mail, enviaremos as instruções.";

function object(raw: string, keys: string[]) {
  if (Buffer.byteLength(raw, "utf8") > ACCOUNT_BODY_LIMIT_BYTES) throw new AccountValidationError();
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new AccountValidationError(); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new AccountValidationError();
  return value as Record<string, unknown>;
}
export function parseRegisterPayload(raw: string): RegisterPayload {
  const value = object(raw, ["name","email","phone","cpf","password","passwordConfirmation","acceptTerms"]);
  if (typeof value.name !== "string" || value.name.trim().length < 3 || typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) || typeof value.phone !== "string" || typeof value.cpf !== "string" || typeof value.password !== "string" || value.password.length < 8 || value.password !== value.passwordConfirmation || value.acceptTerms !== true) throw new AccountValidationError();
  return { name: value.name.trim(), email: value.email.trim().toLowerCase(), phone: value.phone.trim(), cpf: value.cpf.trim(), password: value.password, passwordConfirmation: value.password, acceptTerms: true };
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
