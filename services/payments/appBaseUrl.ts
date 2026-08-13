export class AppBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppBaseUrlError";
  }
}

// Origem pública onde este app está hospedado — usada para montar as URLs de
// webhook/callback enviadas ao Inter e ao PagBank. Nunca deve ficar
// hardcoded no código: hoje aponta para o domínio definitivo
// (persimateriais.com.br). Ao trocar esta variável, é preciso re-registrar
// os webhooks (ver scripts/register-inter-webhooks.mjs).
export function getAppBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const raw = environment.APP_BASE_URL?.trim();
  if (!raw) {
    throw new AppBaseUrlError("Missing server configuration: APP_BASE_URL");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppBaseUrlError("Invalid server configuration: APP_BASE_URL");
  }

  if (url.protocol !== "https:" || url.origin !== raw.replace(/\/$/, "")) {
    throw new AppBaseUrlError("Invalid server configuration: APP_BASE_URL");
  }

  return url.origin;
}

export function buildWebhookUrl(path: string, environment?: NodeJS.ProcessEnv): string {
  return `${getAppBaseUrl(environment)}${path.startsWith("/") ? path : `/${path}`}`;
}
