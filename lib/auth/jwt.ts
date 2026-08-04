import { AuthError } from "./errors.ts";
import { requestWordPressAuth } from "./services.ts";
import { isJwtFormat } from "./token.ts";
import type { JwtTokenResponse } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTokenResponse(value: unknown): JwtTokenResponse {
  if (
    !isRecord(value) ||
    typeof value.token !== "string" ||
    !isJwtFormat(value.token) ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    throw new AuthError(
      "AUTH_RESPONSE_INVALID",
      "Resposta JWT inválida.",
      502,
    );
  }

  return {
    token: value.token,
    expiresAt: value.expires_at,
    userEmail: typeof value.user_email === "string" ? value.user_email : undefined,
    userNicename:
      typeof value.user_nicename === "string" ? value.user_nicename : undefined,
    userDisplayName:
      typeof value.user_display_name === "string"
        ? value.user_display_name
        : undefined,
  };
}

export async function authenticateWithCredentials(input: {
  username: string;
  password: string;
}): Promise<JwtTokenResponse> {
  const result = await requestWordPressAuth("/wp-json/jwt-auth/v1/token", {
    method: "POST",
    body: { username: input.username, password: input.password },
  });

  if (result.status === 401 || result.status === 403) {
    throw new AuthError(
      "AUTH_CREDENTIALS_REJECTED",
      "Não foi possível entrar com os dados informados.",
      401,
    );
  }
  if (result.status < 200 || result.status >= 300) {
    throw new AuthError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Não foi possível acessar sua conta agora.",
      result.status >= 500 ? 502 : result.status,
    );
  }

  return parseTokenResponse(result.body);
}

export async function authenticateWithSocialToken(input: {
  provider: "google" | "facebook";
  token: string;
}): Promise<JwtTokenResponse> {
  const result = await requestWordPressAuth("/wp-json/persi-auth/v1/oauth/token", {
    method: "POST",
    body: input,
  });
  if (result.status === 409) {
    throw new AuthError("AUTH_IDENTITY_CONFLICT", "Conflito de identidade.", 409);
  }
  if (result.status === 401 || result.status === 403) {
    throw new AuthError("AUTH_UNAUTHORIZED", "Identidade social inválida.", 401);
  }
  if (result.status < 200 || result.status >= 300) {
    throw new AuthError("AUTH_SERVICE_UNAVAILABLE", "Serviço social indisponível.", 502);
  }
  return parseTokenResponse(result.body);
}

export async function validateJwt(token: string): Promise<boolean> {
  if (!isJwtFormat(token)) return false;
  const result = await requestWordPressAuth(
    "/wp-json/jwt-auth/v1/token/validate",
    { method: "POST", token },
  );
  return result.status >= 200 && result.status < 300;
}
