import {
  parseAccountSession,
  type AccountLoginPayload,
  type AccountSession,
  type AccountSessionResult,
} from "../../lib/account/validation.ts";
import {
  AccountServiceError,
  getAccountClientConfig,
  requestAccountEndpoint,
  type AccountClientConfig,
} from "./client.ts";

interface AccountLoginResult extends AccountSession {
  sessionToken: string;
}

function getLoginErrorCode(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const code = (body as Record<string, unknown>).code;
    if (
      typeof code === "string" &&
      [
        "ACCOUNT_LOGIN_CREDENTIALS_REJECTED",
        "ACCOUNT_LOGIN_ROLE_REJECTED",
        "ACCOUNT_LOGIN_HMAC_REJECTED",
        "ACCOUNT_LOGIN_SESSION_CREATE_FAILED",
      ].includes(code)
    ) {
      return code;
    }
  }

  return status === 401
    ? "ACCOUNT_LOGIN_WORDPRESS_401"
    : "ACCOUNT_LOGIN_RESPONSE_INVALID";
}

function parseLoginResult(value: unknown): AccountLoginResult {
  const session = parseAccountSession(value);
  const token =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).sessionToken
      : null;
  if (
    !session.authenticated ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    throw new AccountServiceError(
      502,
      "Invalid account login response",
      "ACCOUNT_LOGIN_RESPONSE_INVALID",
    );
  }
  return { ...session, sessionToken: token };
}

export async function loginAccount(
  payload: AccountLoginPayload,
  options: {
    config?: AccountClientConfig;
    fetchImplementation?: typeof fetch;
  } = {},
): Promise<AccountLoginResult> {
  const rawBody = JSON.stringify(payload);
  const result = await requestAccountEndpoint({
    config: options.config ?? getAccountClientConfig(),
    method: "POST",
    route: "/login",
    rawBody,
    fetchImplementation: options.fetchImplementation,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new AccountServiceError(
      [400, 401, 429, 503].includes(result.status) ? result.status : 502,
      "Account login rejected",
      getLoginErrorCode(result.body, result.status),
    );
  }
  return parseLoginResult(result.body);
}

export async function getAccountSession(
  sessionToken: string,
  options: {
    config?: AccountClientConfig;
    fetchImplementation?: typeof fetch;
  } = {},
): Promise<AccountSessionResult> {
  const result = await requestAccountEndpoint({
    config: options.config ?? getAccountClientConfig(),
    method: "GET",
    route: "/session",
    rawBody: "",
    sessionToken,
    fetchImplementation: options.fetchImplementation,
  });
  if (result.status < 200 || result.status >= 300) {
    if (result.status === 401) return { authenticated: false };
    throw new AccountServiceError(
      result.status === 503 ? 503 : 502,
      "Account session unavailable",
    );
  }
  return parseAccountSession(result.body);
}

export async function logoutAccount(
  sessionToken: string,
  options: {
    config?: AccountClientConfig;
    fetchImplementation?: typeof fetch;
  } = {},
): Promise<void> {
  const result = await requestAccountEndpoint({
    config: options.config ?? getAccountClientConfig(),
    method: "POST",
    route: "/logout",
    rawBody: "",
    sessionToken,
    fetchImplementation: options.fetchImplementation,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new AccountServiceError(502, "Account logout unavailable");
  }
}
