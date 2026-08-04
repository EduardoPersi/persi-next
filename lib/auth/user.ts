import { AuthError } from "./errors.ts";
import { requestWordPressAuth } from "./services.ts";
import type { AuthUser } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseAuthUser(value: unknown): AuthUser {
  if (!isRecord(value) || !Number.isInteger(value.id) || Number(value.id) <= 0) {
    throw new AuthError(
      "AUTH_RESPONSE_INVALID",
      "Resposta de usuário inválida.",
      502,
    );
  }

  const roles = Array.isArray(value.roles)
    ? value.roles.filter((role): role is string => typeof role === "string")
    : [];
  const avatarUrls = isRecord(value.avatar_urls) ? value.avatar_urls : {};
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};

  return {
    id: Number(value.id),
    email: stringValue(value.email),
    username: stringValue(value.slug),
    displayName: stringValue(value.name),
    firstName: stringValue(value.first_name),
    lastName: stringValue(value.last_name),
    roles,
    avatar: stringValue(avatarUrls["96"] ?? avatarUrls["48"] ?? avatarUrls["24"]),
    permissions: Object.entries(capabilities)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission),
  };
}

export async function getAuthenticatedUser(token: string): Promise<AuthUser> {
  const result = await requestWordPressAuth(
    "/wp-json/persi-auth/v1/me",
    { token },
  );
  if (result.status === 401 || result.status === 403) {
    throw new AuthError("AUTH_UNAUTHORIZED", "JWT não autorizado.", 401);
  }
  if (result.status < 200 || result.status >= 300) {
    throw new AuthError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Não foi possível consultar o usuário.",
      502,
    );
  }
  return parseAuthUser(result.body);
}
