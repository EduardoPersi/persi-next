import type { GoogleIdentity } from "../../lib/account/googleOAuth.ts";
import {
  parseAccountSession,
  type AccountSession,
} from "../../lib/account/validation.ts";
import {
  AccountServiceError,
  getAccountClientConfig,
  requestAccountEndpoint,
  type AccountClientConfig,
} from "./client.ts";

export interface GoogleAccountSession extends AccountSession {
  sessionToken: string;
}

export async function createGoogleAccountSession(
  identity: GoogleIdentity,
  options: {
    config?: AccountClientConfig;
    fetchImplementation?: typeof fetch;
  } = {},
): Promise<GoogleAccountSession> {
  const result = await requestAccountEndpoint({
    config: options.config ?? getAccountClientConfig(),
    method: "POST",
    route: "/google-login",
    rawBody: JSON.stringify(identity),
    fetchImplementation: options.fetchImplementation,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new AccountServiceError(
      [400, 401, 403, 409, 429, 503].includes(result.status)
        ? result.status
        : 502,
      "Google account login rejected",
    );
  }

  const session = parseAccountSession(result.body);
  const sessionToken =
    result.body && typeof result.body === "object"
      ? (result.body as Record<string, unknown>).sessionToken
      : null;
  if (
    !session.authenticated ||
    typeof sessionToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)
  ) {
    throw new AccountServiceError(502, "Invalid Google account response");
  }
  return { ...session, sessionToken };
}
