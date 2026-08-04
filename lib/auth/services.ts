import { AuthError } from "./errors.ts";
import type { AuthRequestOptions } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

function getWordPressUrl(): string {
  const value = process.env.WORDPRESS_URL?.trim();
  if (!value) {
    throw new AuthError(
      "AUTH_CONFIGURATION_INVALID",
      "WORDPRESS_URL não configurada.",
      503,
    );
  }

  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error();
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new AuthError(
      "AUTH_CONFIGURATION_INVALID",
      "WORDPRESS_URL inválida.",
      503,
    );
  }
}

export async function requestWordPressAuth(
  path: `/${string}`,
  options: AuthRequestOptions = {},
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${getWordPressUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Serviço de autenticação indisponível.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}
