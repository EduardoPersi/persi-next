import type { RegisterPayload } from "../../lib/account/access.ts";
import { RECOVERY_MESSAGE } from "../../lib/account/access.ts";
import { AccountServiceError, getAccountClientConfig, requestAccountEndpoint, type AccountClientConfig } from "./client.ts";
type Options = { config?: AccountClientConfig; fetchImplementation?: typeof fetch };
export async function registerAccount(payload: RegisterPayload, options: Options = {}) {
  const result = await requestAccountEndpoint({ config: options.config ?? getAccountClientConfig(), method: "POST", route: "/register", rawBody: JSON.stringify(payload), fetchImplementation: options.fetchImplementation });
  if (result.status < 200 || result.status >= 300) {
    throw new AccountServiceError(
      [400, 401, 409, 429, 503].includes(result.status) ? result.status : 502,
      "Registration rejected",
    );
  }
  if (!result.body || typeof result.body !== "object" || (result.body as Record<string, unknown>).registered !== true) throw new AccountServiceError(502, "Invalid registration response");
  return { registered: true as const };
}
export async function forgotAccountPassword(email: string, options: Options = {}) {
  const result = await requestAccountEndpoint({ config: options.config ?? getAccountClientConfig(), method: "POST", route: "/forgot-password", rawBody: JSON.stringify({ email }), fetchImplementation: options.fetchImplementation });
  if (result.status < 200 || result.status >= 300) throw new AccountServiceError([400,429,503].includes(result.status) ? result.status : 502, "Recovery unavailable");
  return { message: RECOVERY_MESSAGE };
}
export async function resetAccountPassword(payload: { login: string; key: string; password: string; passwordConfirmation: string }, options: Options = {}) {
  const result = await requestAccountEndpoint({ config: options.config ?? getAccountClientConfig(), method: "POST", route: "/reset-password", rawBody: JSON.stringify(payload), fetchImplementation: options.fetchImplementation });
  if (result.status < 200 || result.status >= 300) throw new AccountServiceError([400,429,503].includes(result.status) ? result.status : 502, "Reset unavailable");
  return { reset: true as const };
}
export async function checkLoginGuard(identifier: string, options: Options = {}) {
  const result = await requestAccountEndpoint({ config: options.config ?? getAccountClientConfig(), method: "POST", route: "/login-guard", rawBody: JSON.stringify({ identifier }), fetchImplementation: options.fetchImplementation });
  if (result.status < 200 || result.status >= 300) throw new AccountServiceError([400,429,503].includes(result.status) ? result.status : 502, "Login guard rejected");
  return { allowed: true as const };
}
