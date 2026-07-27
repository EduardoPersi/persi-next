export const ACCOUNT_BODY_LIMIT_BYTES = 8 * 1024;

export interface AccountCustomer {
  firstName: string;
  displayName: string;
  email: string;
}

export interface AccountSession {
  authenticated: true;
  expiresAt: string;
  customer: AccountCustomer;
}

export interface AccountAnonymousSession {
  authenticated: false;
}

export type AccountSessionResult =
  | AccountSession
  | AccountAnonymousSession;

export interface AccountLoginPayload {
  identifier: string;
  password: string;
  remember: boolean;
}

export class AccountValidationError extends Error {
  constructor(message = "Invalid account data") {
    super(message);
    this.name = "AccountValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAccountLoginPayload(rawBody: string): AccountLoginPayload {
  if (Buffer.byteLength(rawBody, "utf8") > ACCOUNT_BODY_LIMIT_BYTES) {
    throw new AccountValidationError();
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new AccountValidationError();
  }

  if (!isRecord(value)) throw new AccountValidationError();
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "identifier,password,remember") {
    throw new AccountValidationError();
  }
  if (
    typeof value.identifier !== "string" ||
    typeof value.password !== "string" ||
    typeof value.remember !== "boolean"
  ) {
    throw new AccountValidationError();
  }

  const identifier = value.identifier.trim();
  if (
    identifier.length < 1 ||
    identifier.length > 320 ||
    value.password.length < 1 ||
    value.password.length > 4096
  ) {
    throw new AccountValidationError();
  }

  return {
    identifier,
    password: value.password,
    remember: value.remember,
  };
}

export function parseAccountSession(value: unknown): AccountSessionResult {
  if (!isRecord(value) || typeof value.authenticated !== "boolean") {
    throw new AccountValidationError("Invalid account response");
  }
  if (!value.authenticated) return { authenticated: false };
  if (
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !isRecord(value.customer) ||
    typeof value.customer.firstName !== "string" ||
    typeof value.customer.displayName !== "string" ||
    typeof value.customer.email !== "string"
  ) {
    throw new AccountValidationError("Invalid account response");
  }

  return {
    authenticated: true,
    expiresAt: value.expiresAt,
    customer: {
      firstName: value.customer.firstName,
      displayName: value.customer.displayName,
      email: value.customer.email,
    },
  };
}

export function isJsonContentType(value: string | null): boolean {
  return /^application\/json(?:\s*;|$)/i.test(value?.trim() ?? "");
}

export function validateMutationSource(
  headers: Pick<Headers, "get">,
  expectedOrigin: string,
): boolean {
  const origin = headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}
